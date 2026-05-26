package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type config struct {
	addr          string
	dataPath      string
	dbPath        string
	adminToken    string
	adminUsername string
	adminPassword string
	sessionSecret string
}

type server struct {
	cfg      config
	hub      *hub
	users    *userStore
	events   *eventStore
	logger   *slog.Logger
	upgrader websocket.Upgrader
}

type userRecord struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	APIKey       string     `json:"api_key,omitempty"`
	APIKeyPrefix string     `json:"api_key_prefix,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
}

type hub struct {
	mu     sync.RWMutex
	rooms  map[string]*room
	events *eventStore
}

type room struct {
	key                 string
	userID              string
	userName            string
	deviceID            string
	desktop             map[*peer]struct{}
	client              map[*peer]struct{}
	lastSeen            time.Time
	lastDesktopSnapshot []byte
}

type peer struct {
	role           string
	userID         string
	userName       string
	deviceID       string
	clientDeviceID string
	connectedAt    time.Time
	conn           *websocket.Conn
	send           chan []byte
	hub            *hub
	logger         *slog.Logger
}

type relayEnvelope struct {
	Type     string          `json:"type"`
	UserID   string          `json:"user_id"`
	DeviceID string          `json:"device_id"`
	From     string          `json:"from"`
	SentAt   time.Time       `json:"sent_at"`
	Payload  json.RawMessage `json:"payload,omitempty"`
}

type relayEventPayload struct {
	Event relayEventRecord `json:"event"`
}

type relayBacklogPayload struct {
	Events []relayEventRecord `json:"events"`
}

type relayPresenceClient struct {
	ClientDeviceID string    `json:"client_device_id"`
	ConnectedAt    time.Time `json:"connected_at"`
}

type relayPresencePayload struct {
	DeviceID     string                `json:"device_id"`
	DesktopCount int                   `json:"desktop_count"`
	ClientCount  int                   `json:"client_count"`
	Connected    bool                  `json:"connected"`
	LastSeen     time.Time             `json:"last_seen"`
	Clients      []relayPresenceClient `json:"clients"`
}

type deviceSummary struct {
	UserID          string    `json:"user_id"`
	UserName        string    `json:"user_name"`
	DeviceID        string    `json:"device_id"`
	DesktopCount    int       `json:"desktop_count"`
	ClientCount     int       `json:"client_count"`
	LastSeen        time.Time `json:"last_seen"`
	Connected       bool      `json:"connected"`
	RelayTransports []string  `json:"relay_transports"`
}

func main() {
	cfg := parseConfig()
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	users, err := newUserStore(cfg.dbPath, cfg.dataPath, cfg.hashSecret())
	if err != nil {
		logger.Error("failed to open relay data", "error", err)
		os.Exit(1)
	}
	defer users.close()
	events, err := newEventStore(cfg.dbPath)
	if err != nil {
		logger.Error("failed to open relay event db", "error", err)
		os.Exit(1)
	}
	defer events.close()

	srv := newServer(cfg, users, events, logger)
	httpServer := &http.Server{
		Addr:              cfg.addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errs := make(chan error, 1)
	go func() {
		logger.Info("relay listening", "addr", cfg.addr, "data", cfg.dataPath, "db", cfg.dbPath)
		if cfg.adminToken == "" && cfg.adminPassword == "" {
			logger.Warn("admin UI is not protected; set CODEP_RELAY_ADMIN_PASSWORD before exposing this server")
		}
		errs <- httpServer.ListenAndServe()
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-errs:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("relay stopped", "error", err)
			os.Exit(1)
		}
	case sig := <-stop:
		logger.Info("shutdown requested", "signal", sig.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		logger.Error("shutdown failed", "error", err)
		os.Exit(1)
	}
}

func parseConfig() config {
	loadDotEnv(".env")
	addr := flag.String("addr", envDefault("CODEP_RELAY_ADDR", "0.0.0.0:8909"), "HTTP listen address")
	dataPath := flag.String("data", envDefault("CODEP_RELAY_DATA", ".codep-relay.json"), "relay data JSON path")
	dbPath := flag.String("db", envDefault("CODEP_RELAY_DB", ".codep-relay.db"), "relay SQLite database path")
	adminToken := flag.String("admin-token", os.Getenv("CODEP_RELAY_ADMIN_TOKEN"), "optional admin UI/API token")
	adminUsername := flag.String("admin-username", envDefault("CODEP_RELAY_ADMIN_USERNAME", "admin"), "admin username")
	adminPassword := flag.String("admin-password", os.Getenv("CODEP_RELAY_ADMIN_PASSWORD"), "admin password")
	sessionSecret := flag.String("session-secret", os.Getenv("CODEP_RELAY_SESSION_SECRET"), "admin session signing secret")
	flag.Parse()
	return config{
		addr:          *addr,
		dataPath:      *dataPath,
		dbPath:        *dbPath,
		adminToken:    *adminToken,
		adminUsername: *adminUsername,
		adminPassword: *adminPassword,
		sessionSecret: *sessionSecret,
	}
}

func (c config) hashSecret() string {
	if c.sessionSecret != "" {
		return c.sessionSecret
	}
	if c.adminToken != "" {
		return c.adminToken
	}
	if c.adminPassword != "" {
		return c.adminPassword
	}
	return "codep-relay-development-secret"
}

func newServer(cfg config, users *userStore, events *eventStore, logger *slog.Logger) *server {
	return &server{
		cfg:    cfg,
		hub:    newHub(events),
		users:  users,
		events: events,
		logger: logger,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
		},
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", s.handleAdminPage)
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("POST /api/admin/login", s.handleAdminLogin)
	mux.HandleFunc("POST /api/admin/logout", s.handleAdminLogout)
	mux.HandleFunc("GET /api/admin/me", s.handleAdminMe)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/api-keys", s.handleCreateCurrentAPIKey)
	mux.HandleFunc("GET /api/auth/devices", s.handleCurrentDevices)
	mux.HandleFunc("GET /api/invites", s.handleInvites)
	mux.HandleFunc("POST /api/invites", s.handleCreateInvite)
	mux.HandleFunc("DELETE /api/invites/{id}", s.handleRevokeInvite)
	mux.HandleFunc("GET /api/users", s.handleUsers)
	mux.HandleFunc("POST /api/users", s.handleCreateUser)
	mux.HandleFunc("DELETE /api/users/{id}", s.handleRevokeUser)
	mux.HandleFunc("GET /api/devices", s.handleDevices)
	mux.HandleFunc("GET /ws/desktop", s.handleDesktopWebSocket)
	mux.HandleFunc("GET /ws/client", s.handleClientWebSocket)
	return withCORS(mux)
}

func (s *server) handleAdminPage(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := adminTemplate.Execute(w, map[string]any{
		"AdminProtected": s.cfg.adminToken != "" || s.cfg.adminPassword != "",
		"AdminUsername":  s.cfg.adminUsername,
	}); err != nil {
		panic(err)
	}
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

func (s *server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Token    string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	if s.cfg.adminToken != "" && input.Token == s.cfg.adminToken {
		s.setAdminSession(w)
		s.setRelaySession(w, "admin", "admin", s.cfg.adminUsername)
		writeJSON(w, http.StatusOK, map[string]any{"admin": s.adminInfo()})
		return
	}

	if s.cfg.adminPassword == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "admin password is not configured"})
		return
	}
	if input.Username != s.cfg.adminUsername || input.Password != s.cfg.adminPassword {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid admin credentials"})
		return
	}

	s.setAdminSession(w)
	s.setRelaySession(w, "admin", "admin", s.cfg.adminUsername)
	writeJSON(w, http.StatusOK, map[string]any{"admin": s.adminInfo()})
}

func (s *server) handleAdminLogout(w http.ResponseWriter, _ *http.Request) {
	clearAdminSession(w)
	clearRelaySession(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed_out"})
}

func (s *server) handleAdminMe(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"admin": s.adminInfo()})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Token    string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	username := strings.TrimSpace(input.Username)
	if s.cfg.adminToken != "" && strings.TrimSpace(input.Token) == s.cfg.adminToken {
		s.setAdminSession(w)
		s.setRelaySession(w, "admin", "admin", s.cfg.adminUsername)
		writeJSON(w, http.StatusOK, map[string]any{"session": s.sessionInfo(relaySession{
			Role:     "admin",
			UserID:   "admin",
			UserName: s.cfg.adminUsername,
		})})
		return
	}
	if s.cfg.adminPassword != "" && username == s.cfg.adminUsername && input.Password == s.cfg.adminPassword {
		s.setAdminSession(w)
		s.setRelaySession(w, "admin", "admin", s.cfg.adminUsername)
		writeJSON(w, http.StatusOK, map[string]any{"session": s.sessionInfo(relaySession{
			Role:     "admin",
			UserID:   "admin",
			UserName: s.cfg.adminUsername,
		})})
		return
	}

	user, err := s.users.login(username, input.Password)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
		return
	}
	session := relaySession{
		Role:     "user",
		UserID:   user.ID,
		UserName: user.Name,
	}
	s.setRelaySession(w, session.Role, session.UserID, session.UserName)
	writeJSON(w, http.StatusOK, map[string]any{"session": s.sessionInfo(session)})
}

func (s *server) handleLogout(w http.ResponseWriter, _ *http.Request) {
	clearAdminSession(w)
	clearRelaySession(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed_out"})
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	if session, ok := s.currentRelaySession(r); ok {
		writeJSON(w, http.StatusOK, map[string]any{"session": s.sessionInfo(session)})
		return
	}
	if s.authorizedAdmin(r) {
		writeJSON(w, http.StatusOK, map[string]any{"session": s.sessionInfo(relaySession{
			Role:     "admin",
			UserID:   "admin",
			UserName: s.cfg.adminUsername,
		})})
		return
	}
	writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
}

func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username   string `json:"username"`
		Password   string `json:"password"`
		InviteCode string `json:"invite_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	user, apiKey, err := s.users.register(input.Username, input.Password, input.InviteCode)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	user.APIKey = apiKey
	session := relaySession{
		Role:     "user",
		UserID:   user.ID,
		UserName: user.Name,
	}
	s.setRelaySession(w, session.Role, session.UserID, session.UserName)
	writeJSON(w, http.StatusCreated, map[string]any{
		"session": s.sessionInfo(session),
		"user":    user,
		"api_key": apiKey,
	})
}

func (s *server) handleCreateCurrentAPIKey(w http.ResponseWriter, r *http.Request) {
	session, ok := s.currentRelaySession(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}
	if session.Role != "user" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "admin accounts do not use relay API keys"})
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	key, apiKey, err := s.users.createAPIKey(session.UserID, input.Name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"api_key": apiKey, "key": key})
}

func (s *server) handleCurrentDevices(w http.ResponseWriter, r *http.Request) {
	session, ok := s.currentRelaySession(r)
	if ok {
		if session.Role == "admin" {
			writeJSON(w, http.StatusOK, map[string]any{"devices": s.hub.devices()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"devices": s.hub.devicesForUser(session.UserID)})
		return
	}

	user, ok := s.authorizedRelayUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": s.hub.devicesForUser(user.ID)})
}

func (s *server) handleInvites(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": s.users.listInvites()})
}

func (s *server) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}

	var input struct {
		MaxUses   int    `json:"max_uses"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	invite, code, err := s.users.createInvite("admin", input.MaxUses, input.ExpiresAt)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"invite": invite, "code": code})
}

func (s *server) handleRevokeInvite(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}
	if err := s.users.revokeInvite(r.PathValue("id")); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (s *server) handleUsers(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users": s.users.list(),
	})
}

func (s *server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}

	var input struct {
		Name   string `json:"name"`
		APIKey string `json:"api_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}

	user, err := s.users.create(input.Name, input.APIKey)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": user})
}

func (s *server) handleRevokeUser(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}
	if err := s.users.revoke(r.PathValue("id")); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (s *server) handleDevices(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not signed in"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"devices": s.hub.devices(),
	})
}

func (s *server) handleDesktopWebSocket(w http.ResponseWriter, r *http.Request) {
	s.handleWebSocket(w, r, "desktop")
}

func (s *server) handleClientWebSocket(w http.ResponseWriter, r *http.Request) {
	s.handleWebSocket(w, r, "client")
}

func (s *server) handleWebSocket(w http.ResponseWriter, r *http.Request, role string) {
	user, ok := s.authorizedRelayUser(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "invalid api key",
		})
		return
	}

	deviceID := strings.TrimSpace(r.URL.Query().Get("device_id"))
	if deviceID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "device_id is required",
		})
		return
	}
	clientDeviceID := strings.TrimSpace(r.URL.Query().Get("client_device_id"))
	if role == "client" && clientDeviceID == "" {
		clientDeviceID = "client:" + r.RemoteAddr
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Warn("websocket upgrade failed", "role", role, "error", err)
		return
	}

	p := &peer{
		role:           role,
		userID:         user.ID,
		userName:       user.Name,
		deviceID:       deviceID,
		clientDeviceID: clientDeviceID,
		connectedAt:    time.Now().UTC(),
		conn:           conn,
		send:           make(chan []byte, 32),
		hub:            s.hub,
		logger: s.logger.With(
			"role", role,
			"user_id", user.ID,
			"device_id", deviceID,
		),
	}
	s.hub.register(p)
	p.logger.Info("peer connected")

	go p.writeLoop()
	p.readLoop()
}

func (s *server) authorizedAdmin(r *http.Request) bool {
	if session, ok := s.currentRelaySession(r); ok && session.Role == "admin" {
		return true
	}
	if s.cfg.adminToken == "" && s.cfg.adminPassword == "" {
		return true
	}
	token := r.Header.Get("X-CodeP-Admin-Token")
	if token == "" {
		token = r.URL.Query().Get("admin_token")
	}
	if s.cfg.adminToken != "" && token == s.cfg.adminToken {
		return true
	}
	return s.validAdminSession(r)
}

func (s *server) adminInfo() map[string]any {
	return map[string]any{
		"username": s.cfg.adminUsername,
		"mode": map[string]bool{
			"password": s.cfg.adminPassword != "",
			"token":    s.cfg.adminToken != "",
			"dev":      s.cfg.adminPassword == "" && s.cfg.adminToken == "",
		},
	}
}

func (s *server) sessionInfo(session relaySession) map[string]any {
	info := map[string]any{
		"role":     session.Role,
		"user_id":  session.UserID,
		"username": session.UserName,
	}
	if session.Role == "admin" {
		info["admin"] = s.adminInfo()
		return info
	}
	user, err := s.users.byID(session.UserID)
	if err == nil {
		info["user"] = user
		info["api_keys"] = s.users.listAPIKeys(session.UserID)
	}
	return info
}

func (s *server) authorizedRelayUser(r *http.Request) (userRecord, bool) {
	key := r.Header.Get("X-CodeP-Api-Key")
	if key == "" {
		key = r.URL.Query().Get("api_key")
	}
	if key == "" {
		const prefix = "Bearer "
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(auth, prefix) {
			key = strings.TrimSpace(strings.TrimPrefix(auth, prefix))
		}
	}
	return s.users.authenticate(key)
}

func newHub(events *eventStore) *hub {
	return &hub{
		rooms:  make(map[string]*room),
		events: events,
	}
}

func (h *hub) register(p *peer) {
	h.mu.Lock()
	defer h.mu.Unlock()

	r := h.ensureRoom(p.userID, p.userName, p.deviceID)
	if p.role == "desktop" {
		r.desktop[p] = struct{}{}
	} else {
		r.client[p] = struct{}{}
	}
	r.lastSeen = time.Now().UTC()

	p.send <- mustJSON(relayEnvelope{
		Type:     "relay.connected",
		UserID:   p.userID,
		DeviceID: p.deviceID,
		From:     "relay",
		SentAt:   time.Now().UTC(),
	})
	h.broadcastPresenceLocked(r)
	if p.role == "client" && len(r.lastDesktopSnapshot) > 0 {
		p.send <- cloneBytes(r.lastDesktopSnapshot)
	}
}

func (h *hub) unregister(p *peer) {
	h.mu.Lock()
	defer h.mu.Unlock()

	r := h.rooms[roomKey(p.userID, p.deviceID)]
	if r == nil {
		return
	}
	if p.role == "desktop" {
		delete(r.desktop, p)
	} else {
		delete(r.client, p)
	}
	r.lastSeen = time.Now().UTC()
	close(p.send)

	if len(r.desktop) == 0 && len(r.client) == 0 {
		delete(h.rooms, r.key)
		return
	}
	h.broadcastPresenceLocked(r)
}

func (h *hub) broadcastPresenceLocked(r *room) {
	now := time.Now().UTC()
	clients := make([]relayPresenceClient, 0, len(r.client))
	for p := range r.client {
		clients = append(clients, relayPresenceClient{
			ClientDeviceID: p.clientDeviceID,
			ConnectedAt:    p.connectedAt,
		})
	}

	message := mustJSON(relayEnvelope{
		Type:     "relay.presence",
		UserID:   r.userID,
		DeviceID: r.deviceID,
		From:     "relay",
		SentAt:   now,
		Payload: mustRawJSON(relayPresencePayload{
			DeviceID:     r.deviceID,
			DesktopCount: len(r.desktop),
			ClientCount:  len(r.client),
			Connected:    len(r.desktop) > 0,
			LastSeen:     r.lastSeen,
			Clients:      clients,
		}),
	})

	for p := range r.desktop {
		select {
		case p.send <- message:
		default:
			p.logger.Warn("dropping relay presence for slow peer")
		}
	}
	for p := range r.client {
		select {
		case p.send <- message:
		default:
			p.logger.Warn("dropping relay presence for slow peer")
		}
	}
}

func (h *hub) forward(from *peer, payload []byte) {
	msg := normalizeEnvelope(from, payload)

	h.mu.Lock()
	r := h.rooms[roomKey(from.userID, from.deviceID)]
	if r == nil {
		h.mu.Unlock()
		return
	}
	if from.role == "desktop" && envelopeType(msg) == "desktop.snapshot" {
		r.lastDesktopSnapshot = cloneBytes(msg)
	}

	targets := r.client
	if from.role == "client" {
		targets = r.desktop
	}

	peers := make([]*peer, 0, len(targets))
	for p := range targets {
		peers = append(peers, p)
	}
	h.mu.Unlock()

	for _, p := range peers {
		select {
		case p.send <- msg:
		default:
			p.logger.Warn("dropping relay message for slow peer")
		}
	}
}

func (h *hub) publishEvent(from *peer, request eventPublishRequest) {
	if h.events == nil {
		from.send <- relayError("event.unavailable", "relay event store is not configured")
		return
	}
	if from.role != "desktop" {
		from.send <- relayError("event.rejected", "only desktop peers can publish events")
		return
	}

	event, err := h.events.publish(from.userID, from.deviceID, request)
	if err != nil {
		from.send <- relayError("event.rejected", err.Error())
		return
	}

	from.send <- mustJSON(relayEnvelope{
		Type:     "event.published",
		UserID:   from.userID,
		DeviceID: from.deviceID,
		From:     "relay",
		SentAt:   time.Now().UTC(),
		Payload:  mustRawJSON(relayEventPayload{Event: event}),
	})
	h.deliverEvent(from.userID, from.deviceID, event)
}

func (h *hub) resumeEvents(peer *peer, clientLastEventID int64) {
	if h.events == nil {
		peer.send <- relayError("event.unavailable", "relay event store is not configured")
		return
	}
	if peer.role != "client" {
		return
	}

	serverLastEventID, err := h.events.cursor(peer.userID, peer.deviceID, peer.clientDeviceID)
	if err != nil {
		peer.send <- relayError("event.resume_failed", err.Error())
		return
	}

	afterID := clientLastEventID
	if afterID < 0 {
		afterID = 0
	}
	if serverLastEventID > 0 && serverLastEventID < afterID {
		afterID = serverLastEventID
	}

	events, err := h.events.listAfter(peer.userID, peer.deviceID, afterID, maxBacklogEvents)
	if err != nil {
		peer.send <- relayError("event.resume_failed", err.Error())
		return
	}

	peer.send <- mustJSON(relayEnvelope{
		Type:     "event.backlog",
		UserID:   peer.userID,
		DeviceID: peer.deviceID,
		From:     "relay",
		SentAt:   time.Now().UTC(),
		Payload:  mustRawJSON(relayBacklogPayload{Events: events}),
	})
}

func (h *hub) ackEvent(peer *peer, lastEventID int64) {
	if h.events == nil || peer.role != "client" {
		return
	}
	if err := h.events.ack(peer.userID, peer.deviceID, peer.clientDeviceID, lastEventID); err != nil {
		peer.send <- relayError("event.ack_failed", err.Error())
	}
}

func (h *hub) deliverEvent(userID string, deviceID string, event relayEventRecord) {
	h.mu.RLock()
	r := h.rooms[roomKey(userID, deviceID)]
	if r == nil {
		h.mu.RUnlock()
		return
	}

	peers := make([]*peer, 0, len(r.client))
	for p := range r.client {
		peers = append(peers, p)
	}
	h.mu.RUnlock()

	message := mustJSON(relayEnvelope{
		Type:     "event.deliver",
		UserID:   userID,
		DeviceID: deviceID,
		From:     "relay",
		SentAt:   time.Now().UTC(),
		Payload:  mustRawJSON(relayEventPayload{Event: event}),
	})
	for _, p := range peers {
		select {
		case p.send <- message:
		default:
			p.logger.Warn("dropping relay event for slow peer")
		}
	}
}

func envelopeType(payload []byte) string {
	var raw struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(payload, &raw); err != nil {
		return ""
	}
	return raw.Type
}

func cloneBytes(value []byte) []byte {
	if len(value) == 0 {
		return nil
	}
	next := make([]byte, len(value))
	copy(next, value)
	return next
}

func (h *hub) devices() []deviceSummary {
	h.mu.RLock()
	defer h.mu.RUnlock()

	devices := make([]deviceSummary, 0, len(h.rooms))
	for _, r := range h.rooms {
		devices = append(devices, deviceSummary{
			UserID:          r.userID,
			UserName:        r.userName,
			DeviceID:        r.deviceID,
			DesktopCount:    len(r.desktop),
			ClientCount:     len(r.client),
			LastSeen:        r.lastSeen,
			Connected:       len(r.desktop) > 0,
			RelayTransports: []string{"websocket"},
		})
	}
	return devices
}

func (h *hub) devicesForUser(userID string) []deviceSummary {
	h.mu.RLock()
	defer h.mu.RUnlock()

	devices := []deviceSummary{}
	for _, r := range h.rooms {
		if r.userID != userID {
			continue
		}
		devices = append(devices, deviceSummary{
			UserID:          r.userID,
			UserName:        r.userName,
			DeviceID:        r.deviceID,
			DesktopCount:    len(r.desktop),
			ClientCount:     len(r.client),
			LastSeen:        r.lastSeen,
			Connected:       len(r.desktop) > 0,
			RelayTransports: []string{"websocket"},
		})
	}
	return devices
}

func (h *hub) ensureRoom(userID string, userName string, deviceID string) *room {
	key := roomKey(userID, deviceID)
	r := h.rooms[key]
	if r != nil {
		return r
	}
	r = &room{
		key:      key,
		userID:   userID,
		userName: userName,
		deviceID: deviceID,
		desktop:  make(map[*peer]struct{}),
		client:   make(map[*peer]struct{}),
	}
	h.rooms[key] = r
	return r
}

func (p *peer) readLoop() {
	defer func() {
		p.hub.unregister(p)
		p.conn.Close()
		p.logger.Info("peer disconnected")
	}()

	p.conn.SetReadLimit(64 << 20)
	_ = p.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	p.conn.SetPongHandler(func(string) error {
		return p.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	})

	for {
		messageType, payload, err := p.conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}
		if p.handleControlMessage(payload) {
			continue
		}
		p.hub.forward(p, payload)
	}
}

func (p *peer) handleControlMessage(payload []byte) bool {
	var raw struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(payload, &raw); err != nil {
		return false
	}

	switch raw.Type {
	case "event.publish":
		var request eventPublishRequest
		if err := json.Unmarshal(raw.Payload, &request); err != nil {
			p.send <- relayError("event.rejected", "invalid event payload")
			return true
		}
		p.hub.publishEvent(p, request)
		return true
	case "client.resume_events":
		var request struct {
			LastEventID int64 `json:"last_event_id"`
		}
		if len(raw.Payload) > 0 {
			_ = json.Unmarshal(raw.Payload, &request)
		}
		p.hub.resumeEvents(p, request.LastEventID)
		return true
	case "event.ack":
		var request struct {
			LastEventID int64 `json:"last_event_id"`
		}
		if len(raw.Payload) > 0 {
			_ = json.Unmarshal(raw.Payload, &request)
		}
		p.hub.ackEvent(p, request.LastEventID)
		return true
	default:
		return false
	}
}

func (p *peer) writeLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = p.conn.Close()
	}()

	for {
		select {
		case payload, ok := <-p.send:
			_ = p.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = p.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := p.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		case <-ticker.C:
			_ = p.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := p.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func normalizeEnvelope(from *peer, payload []byte) []byte {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(payload, &raw); err == nil {
		if _, ok := raw["type"]; ok {
			raw["user_id"] = mustRawJSON(from.userID)
			raw["device_id"] = mustRawJSON(from.deviceID)
			raw["from"] = mustRawJSON(from.role)
			raw["sent_at"] = mustRawJSON(time.Now().UTC())
			out, err := json.Marshal(raw)
			if err == nil {
				return out
			}
		}
	}

	return mustJSON(relayEnvelope{
		Type:     "relay.message",
		UserID:   from.userID,
		DeviceID: from.deviceID,
		From:     from.role,
		SentAt:   time.Now().UTC(),
		Payload:  payload,
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CodeP-Admin-Token, X-CodeP-Api-Key")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		panic(err)
	}
}

func mustJSON(value any) []byte {
	out, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return out
}

func mustRawJSON(value any) json.RawMessage {
	return json.RawMessage(mustJSON(value))
}

func relayError(code string, message string) []byte {
	return mustJSON(map[string]any{
		"type":    "relay.error",
		"from":    "relay",
		"sent_at": time.Now().UTC(),
		"payload": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func randomHex(bytes int) string {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buf)
}

func roomKey(userID string, deviceID string) string {
	return userID + "\x00" + deviceID
}

func envDefault(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

var adminTemplate = template.Must(template.New("admin").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex+ Relay</title>
  <style>
    :root {
      --canvas: #ffffff;
      --soft: #f8fafc;
      --soft-2: #f1f3f6;
      --line: #dddddd;
      --line-strong: #9297a0;
      --ink: #181d26;
      --body: #333840;
      --muted: #68707d;
      --primary: #181d26;
      --primary-active: #0d1218;
      --danger: #aa2d00;
      --danger-soft: #fff3ef;
      --success: #006400;
      --success-soft: #f3fff6;
      --warning: #8a5a00;
      --warning-soft: #fff7df;
      --focus: #458fff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--soft);
      color: var(--body);
      font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    button, input {
      font: inherit;
      letter-spacing: 0;
    }
    h1, h2, h3, p { margin: 0; }
    h1 {
      color: var(--ink);
      font-size: 24px;
      font-weight: 500;
      line-height: 1.2;
    }
    h2 {
      color: var(--ink);
      font-size: 18px;
      font-weight: 500;
      line-height: 1.35;
    }
    h3 {
      color: var(--ink);
      font-size: 14px;
      font-weight: 650;
      line-height: 1.35;
    }
    a {
      color: #1b61c9;
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
    .appHeader {
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.96);
      backdrop-filter: blur(8px);
    }
    .headerInner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      max-width: 1240px;
      margin: 0 auto;
      padding: 18px 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }
    .brandMark {
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border-radius: 8px;
      background: var(--primary);
      color: white;
      font-weight: 700;
      font-size: 18px;
      flex: 0 0 auto;
    }
    .brandCopy {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .eyebrow {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
    }
    .headerActions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .languageToggle {
      display: inline-grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 3px;
      background: var(--soft);
    }
    .languageButton {
      min-height: 30px;
      border-color: transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--body);
      padding: 0 9px;
      font-size: 12px;
      font-weight: 650;
    }
    .languageButton:hover {
      background: var(--canvas);
      color: var(--ink);
    }
    body[data-language="en"] #languageEn,
    body[data-language="zh"] #languageZh {
      border-color: var(--canvas);
      background: var(--canvas);
      color: var(--ink);
      box-shadow: 0 1px 2px rgba(24, 29, 38, 0.08);
    }
    .shell {
      display: grid;
      grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
      gap: 18px;
      max-width: 1240px;
      margin: 0 auto;
      padding: 18px 24px 32px;
    }
    .sidebar, .content {
      display: grid;
      gap: 18px;
      align-content: start;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--canvas);
      overflow: hidden;
    }
    .panelHeader {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid var(--line);
      padding: 16px;
    }
    .panelTitle {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .panelBody {
      padding: 16px;
    }
    .stack {
      display: grid;
      gap: 14px;
    }
    .fieldGrid {
      display: grid;
      gap: 12px;
    }
    .twoCol {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--ink);
      font-size: 12px;
      font-weight: 650;
    }
    input {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 11px;
      background: var(--canvas);
      color: var(--ink);
      outline: none;
    }
    input:focus {
      border-color: var(--focus);
      box-shadow: 0 0 0 3px rgba(69, 143, 255, 0.14);
    }
    button {
      display: inline-flex;
      min-height: 40px;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 1px solid var(--primary);
      border-radius: 8px;
      padding: 0 14px;
      background: var(--primary);
      color: white;
      font-weight: 650;
      cursor: pointer;
      user-select: none;
    }
    button:hover { background: var(--primary-active); }
    button:focus-visible {
      outline: 3px solid rgba(69, 143, 255, 0.28);
      outline-offset: 2px;
    }
    button.secondary {
      border-color: var(--line);
      background: var(--canvas);
      color: var(--ink);
    }
    button.secondary:hover {
      border-color: var(--line-strong);
      background: var(--soft);
    }
    button.ghost {
      min-height: 32px;
      border-color: transparent;
      background: transparent;
      color: var(--body);
      padding: 0 8px;
    }
    button.ghost:hover { background: var(--soft-2); }
    button.danger {
      border-color: var(--danger);
      background: var(--danger);
      color: white;
    }
    button.danger:hover { background: #8f2600; }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .inline {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .muted {
      color: var(--muted);
      font-size: 12px;
    }
    .caption {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .pill {
      display: inline-flex;
      width: fit-content;
      min-height: 28px;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 10px;
      background: var(--canvas);
      color: var(--body);
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }
    .pill.success {
      border-color: #9bd3a8;
      background: var(--success-soft);
      color: var(--success);
    }
    .pill.warning {
      border-color: #e2c35b;
      background: var(--warning-soft);
      color: var(--warning);
    }
    .pill.danger {
      border-color: #df8b68;
      background: var(--danger-soft);
      color: var(--danger);
    }
    .statusDot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .metric {
      display: grid;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: var(--canvas);
      min-height: 96px;
    }
    .metricValue {
      color: var(--ink);
      font-size: 30px;
      font-weight: 500;
      line-height: 1;
    }
    .metricLabel {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }
    .resourceList {
      display: grid;
      gap: 0;
    }
    .resourceItem {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      padding: 14px 16px;
      border-top: 1px solid var(--line);
      background: var(--canvas);
    }
    .resourceItem:first-child { border-top: 0; }
    .resourceMain {
      display: grid;
      gap: 7px;
      min-width: 0;
    }
    .resourceTitle {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--ink);
      font-weight: 650;
    }
    .truncate {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .resourceMeta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 12px;
    }
    .mono, code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    code, .tokenBox {
      overflow-wrap: anywhere;
      border-radius: 5px;
      background: #eef1f5;
      color: var(--ink);
    }
    code {
      padding: 2px 5px;
    }
    .tokenBox {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border: 1px solid var(--line);
      padding: 10px 10px 10px 12px;
    }
    .tokenBox .mono {
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--ink);
    }
    .message {
      display: none;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: var(--soft);
      color: var(--body);
    }
    .message[data-visible="true"] {
      display: block;
    }
    .message.error {
      border-color: #df8b68;
      background: var(--danger-soft);
      color: var(--danger);
    }
    .message.success {
      border-color: #9bd3a8;
      background: var(--success-soft);
      color: var(--success);
    }
    .empty {
      display: grid;
      place-items: start;
      gap: 8px;
      padding: 24px 16px;
      color: var(--muted);
      border-top: 1px solid var(--line);
      background: var(--canvas);
    }
    .empty strong {
      color: var(--ink);
      font-weight: 650;
    }
    .tableActions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
    .configNote {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 12px;
      background: var(--soft);
      color: var(--muted);
      font-size: 12px;
    }
    .authSummary {
      display: none;
      gap: 8px;
    }
    .authScreen {
      max-width: 1080px;
      margin: 0 auto;
      padding: 56px 24px 32px;
    }
    .authShell {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(360px, 430px);
      gap: 48px;
      align-items: start;
    }
    .authIntro {
      display: grid;
      gap: 18px;
      max-width: 520px;
      padding-top: 20px;
    }
    .authIntro h2 {
      max-width: 12ch;
      color: var(--ink);
      font-size: 40px;
      font-weight: 400;
      line-height: 1.12;
    }
    .authIntro p {
      max-width: 58ch;
      color: var(--body);
      font-size: 15px;
      line-height: 1.55;
    }
    .authFacts {
      display: grid;
      gap: 10px;
      margin-top: 10px;
      padding: 0;
      list-style: none;
    }
    .authFacts li {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
    }
    .authFacts li::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--ink);
      flex: 0 0 auto;
    }
    .authPanel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--canvas);
      overflow: hidden;
    }
    .authPanelHeader {
      display: grid;
      gap: 14px;
      border-bottom: 1px solid var(--line);
      padding: 18px;
    }
    .authPanelTitle {
      display: grid;
      gap: 4px;
    }
    .authPanelTitle h2 {
      font-size: 20px;
      font-weight: 500;
    }
    .authTabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 4px;
      background: var(--soft);
    }
    .authTab {
      min-height: 34px;
      border-color: transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--body);
      padding: 0 10px;
      font-size: 13px;
    }
    .authTab:hover {
      background: var(--canvas);
      color: var(--ink);
    }
    body[data-auth-mode="login"] #loginModeButton,
    body[data-auth-mode="register"] #registerModeButton {
      border-color: var(--canvas);
      background: var(--canvas);
      color: var(--ink);
      box-shadow: 0 1px 2px rgba(24, 29, 38, 0.08);
    }
    .authForm {
      display: grid;
      gap: 14px;
      padding: 18px;
    }
    body[data-auth-mode="login"] .registerForm,
    body[data-auth-mode="register"] .loginForm {
      display: none;
    }
    .authSwitch {
      border-top: 1px solid var(--line);
      padding: 14px 18px 18px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }
    .linkButton {
      min-height: auto;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--link);
      padding: 0;
      font-size: inherit;
      font-weight: 650;
    }
    .linkButton:hover {
      background: transparent;
      color: var(--link-active);
      text-decoration: underline;
    }
    .advancedAuth {
      display: grid;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
    }
    .advancedAuth summary {
      width: fit-content;
      cursor: pointer;
      color: var(--body);
      font-weight: 650;
    }
    .consoleShell {
      display: grid;
    }
    body[data-auth="signed-in"] .authScreen {
      display: none;
    }
    body[data-auth="signed-out"] .consoleShell,
    body[data-auth="boot"] .consoleShell {
      display: none;
    }
    body[data-auth="signed-out"] #refreshAll,
    body[data-auth="boot"] #refreshAll,
    body[data-auth="signed-out"] #signOut,
    body[data-auth="boot"] #signOut {
      display: none;
    }
    body[data-role="admin"] .userOnly,
    body[data-role="user"] .adminOnly,
    body[data-role="none"] .adminOnly,
    body[data-role="none"] .userOnly {
      display: none;
    }
    body[data-auth="signed-in"] .authSummary {
      display: grid;
    }
    .toast {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 20;
      display: none;
      max-width: min(420px, calc(100vw - 40px));
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--primary);
      color: white;
      padding: 12px 14px;
      box-shadow: 0 16px 40px rgba(24, 29, 38, 0.18);
    }
    .toast[data-visible="true"] {
      display: block;
    }
    @media (max-width: 920px) {
      .shell {
        grid-template-columns: 1fr;
        padding: 14px;
      }
      .metrics { grid-template-columns: 1fr; }
      .authScreen {
        padding: 14px;
      }
      .authShell {
        grid-template-columns: 1fr;
        gap: 18px;
      }
      .authIntro {
        padding-top: 8px;
      }
      .authIntro h2 {
        max-width: 14ch;
        font-size: 30px;
      }
      .headerInner {
        align-items: flex-start;
        flex-direction: column;
        padding: 16px 14px;
      }
      .headerActions {
        justify-content: flex-start;
      }
      .twoCol {
        grid-template-columns: 1fr;
      }
      .resourceItem {
        grid-template-columns: 1fr;
      }
      .tableActions {
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body data-auth="boot" data-auth-mode="login" data-language="en" data-role="none">
  <header class="appHeader">
    <div class="headerInner">
      <div class="brand">
        <div class="brandMark" aria-hidden="true">C+</div>
        <div class="brandCopy">
          <h1>Codex+ Relay</h1>
          <p class="eyebrow" data-i18n="brandSubtitle">Remote access, account sessions, API keys, and device presence.</p>
        </div>
      </div>
      <div class="headerActions">
        <div class="languageToggle" aria-label="Language">
          <button class="languageButton" id="languageEn" type="button">EN</button>
          <button class="languageButton" id="languageZh" type="button">中文</button>
        </div>
        <span class="pill {{if .AdminProtected}}success{{else}}warning{{end}}" data-protected="{{if .AdminProtected}}true{{else}}false{{end}}" id="protectionPill">
          <span class="statusDot"></span>
          <span id="protectionPillText">{{if .AdminProtected}}Admin protected{{else}}Development mode{{end}}</span>
        </span>
        <span class="pill" id="sessionPill" data-i18n="checkingSession">Checking session</span>
        <button class="secondary" id="refreshAll" type="button" data-i18n="refresh">Refresh</button>
        <button class="secondary" id="signOut" type="button" data-i18n="signOut">Sign out</button>
      </div>
    </div>
  </header>

  <main class="authScreen">
    <div class="authShell">
      <section class="authIntro" aria-labelledby="auth-intro-title">
        <span class="caption" data-i18n="relayAccess">Relay access</span>
        <h2 id="auth-intro-title" data-i18n="authIntroTitle">Sign in to your control console.</h2>
        <p><span data-i18n="authIntroBody">Use a Relay account to manage your own API keys and connected devices. The account configured in</span> <code>.env</code> <span data-i18n="authIntroBodySuffix">signs in with administrator permissions.</span></p>
        <ul class="authFacts">
          <li data-i18n="authFactInvite">New users register with an invite code.</li>
          <li data-i18n="authFactAdmin">Administrators create and revoke invite codes after signing in.</li>
          <li data-i18n="authFactKey">API keys are shown in full only at creation time.</li>
        </ul>
      </section>

      <section class="authPanel" aria-labelledby="auth-panel-title">
        <div class="authPanelHeader">
          <div class="authPanelTitle">
            <h2 id="auth-panel-title" data-i18n="welcomeTitle">Welcome to Codex+ Relay</h2>
            <p class="muted" id="authModeHelp">Enter your account credentials to continue.</p>
          </div>
          <div class="authTabs" role="tablist" aria-label="Authentication mode">
            <button class="authTab" id="loginModeButton" type="button" role="tab" aria-controls="loginForm" aria-selected="true" data-i18n="signIn">Sign in</button>
            <button class="authTab" id="registerModeButton" type="button" role="tab" aria-controls="registerForm" aria-selected="false" data-i18n="register">Register</button>
          </div>
        </div>

        <form class="authForm loginForm" id="loginForm" autocomplete="on">
          <div class="fieldGrid">
            <label>
              <span data-i18n="username">Username</span>
              <input id="loginUsername" autocomplete="username" data-i18n-placeholder="usernamePlaceholder" placeholder="Username">
            </label>
            <label>
              <span data-i18n="password">Password</span>
              <input id="loginPassword" autocomplete="current-password" data-i18n-placeholder="passwordPlaceholder" type="password" placeholder="Password">
            </label>
          </div>
          <button id="signIn" type="submit" data-i18n="signIn">Sign in</button>
          <div id="loginMessage" class="message" role="status"></div>
        </form>

        <form class="authForm registerForm" id="registerForm" autocomplete="on">
          <div class="fieldGrid">
            <label>
              <span data-i18n="username">Username</span>
              <input id="registerUsername" autocomplete="username" data-i18n-placeholder="chooseUsername" placeholder="Choose a username">
            </label>
            <label>
              <span data-i18n="password">Password</span>
              <input id="registerPassword" autocomplete="new-password" data-i18n-placeholder="createPassword" type="password" placeholder="Create a password">
            </label>
            <label>
              <span data-i18n="confirmPassword">Confirm password</span>
              <input id="registerPasswordConfirm" autocomplete="new-password" data-i18n-placeholder="repeatPassword" type="password" placeholder="Repeat the password">
            </label>
            <label>
              <span data-i18n="inviteCode">Invite code</span>
              <input id="registerInviteCode" autocomplete="off" placeholder="cp_inv_...">
            </label>
          </div>
          <button id="registerUser" type="submit" data-i18n="createAccount">Create account</button>
          <div id="registerMessage" class="message" role="status"></div>
        </form>

        <div class="authSwitch">
          <span id="authSwitchText">No account yet?</span>
          <button class="linkButton" id="authSwitchButton" type="button">Register with invite code</button>
        </div>
      </section>
    </div>
  </main>

  <main class="shell consoleShell">
    <aside class="sidebar">
      <section class="panel">
        <div class="panelHeader">
          <div class="panelTitle">
            <h2 data-i18n="account">Account</h2>
            <p class="muted" data-i18n="accountSubtitle">Current Relay console session.</p>
          </div>
        </div>
        <div class="panelBody stack">
          <div class="authSummary">
            <span class="caption" data-i18n="currentSession">Current session</span>
            <strong id="signedInName">Signed in</strong>
            <span class="pill" id="rolePill">User</span>
          </div>
          <p class="configNote adminOnly" data-i18n="adminAccessNote">Administrator access can manage users, invite codes, direct API keys, and all connected devices.</p>
          <p class="configNote userOnly" data-i18n="userAccessNote">User access can manage personal API keys and view devices connected with those keys.</p>
        </div>
      </section>

      <section class="panel userOnly">
        <div class="panelHeader">
          <div class="panelTitle">
            <h2 data-i18n="createApiKey">Create API key</h2>
            <p class="muted" data-i18n="createOwnApiKeySubtitle">Generate a key for desktop and mobile clients.</p>
          </div>
        </div>
        <div class="panelBody stack">
          <label>
            <span data-i18n="keyName">Key name</span>
            <input id="currentKeyName" data-i18n-placeholder="desktopAndMobile" placeholder="Desktop and mobile">
          </label>
          <button id="createCurrentKey" type="button" data-i18n="createApiKey">Create API key</button>
          <div id="currentKeyMessage" class="message" role="status"></div>
        </div>
      </section>

      <section class="panel adminOnly">
        <div class="panelHeader">
          <div class="panelTitle">
            <h2 data-i18n="createInvite">Create invite</h2>
            <p class="muted" data-i18n="createInviteSubtitle">Issue registration codes for new users.</p>
          </div>
        </div>
        <div class="panelBody stack">
          <div class="twoCol">
            <label>
              <span data-i18n="maxUses">Max uses</span>
              <input id="inviteMaxUses" type="number" min="1" value="1">
            </label>
            <label>
              <span data-i18n="expiresAt">Expires at</span>
              <input id="inviteExpiresAt" type="datetime-local">
            </label>
          </div>
          <button id="createInvite" type="button" data-i18n="createInvite">Create invite</button>
          <div id="inviteMessage" class="message" role="status"></div>
        </div>
      </section>

      <section class="panel adminOnly">
        <div class="panelHeader">
          <div class="panelTitle">
            <h2 data-i18n="createApiKey">Create API key</h2>
            <p class="muted" data-i18n="adminCreateApiKeySubtitle">Provision a direct key without registration for local testing.</p>
          </div>
        </div>
        <div class="panelBody stack">
          <label>
            <span data-i18n="userName">User name</span>
            <input id="userName" data-i18n-placeholder="userNameExample" placeholder="e.g. three">
          </label>
          <label>
            <span data-i18n="apiKey">API key</span>
            <input id="apiKey" data-i18n-placeholder="leaveBlankGenerate" placeholder="Leave blank to generate">
          </label>
          <button id="createUser" type="button" data-i18n="createApiKey">Create API key</button>
          <div id="formMessage" class="message" role="status"></div>
        </div>
      </section>
    </aside>

    <section class="content">
      <div class="metrics" aria-label="Relay overview">
        <div class="metric">
          <span class="metricLabel" data-i18n="activeDevices">Active devices</span>
          <strong class="metricValue" id="deviceMetric">0</strong>
          <span class="muted" id="deviceMetricHint">No desktop peers online</span>
        </div>
        <div class="metric adminOnly">
          <span class="metricLabel" data-i18n="users">Users</span>
          <strong class="metricValue" id="userMetric">0</strong>
          <span class="muted" id="userMetricHint">No active keys loaded</span>
        </div>
        <div class="metric userOnly">
          <span class="metricLabel" data-i18n="apiKeys">API keys</span>
          <strong class="metricValue" id="keyMetric">0</strong>
          <span class="muted" id="keyMetricHint">No active keys</span>
        </div>
        <div class="metric adminOnly">
          <span class="metricLabel" data-i18n="invites">Invites</span>
          <strong class="metricValue" id="inviteMetric">0</strong>
          <span class="muted" id="inviteMetricHint">No active invite codes</span>
        </div>
      </div>

      <section class="panel">
        <div class="panelHeader">
          <div class="panelTitle">
            <h2 data-i18n="connectedDevices">Connected devices</h2>
            <p class="muted adminOnly" data-i18n="connectedDevicesAdminSubtitle">Desktop and mobile peers currently known to this relay.</p>
            <p class="muted userOnly" data-i18n="connectedDevicesUserSubtitle">Desktop and mobile peers currently connected with your account.</p>
          </div>
          <button class="secondary" id="refreshDevices" type="button" data-i18n="refresh">Refresh</button>
        </div>
        <div class="resourceList" id="devices"></div>
      </section>

      <section class="panel userOnly">
        <div class="panelHeader">
          <div class="panelTitle">
            <h2 data-i18n="apiKeys">API keys</h2>
            <p class="muted" data-i18n="apiKeysSubtitle">Active key prefixes for your account. Full keys are shown only when created.</p>
          </div>
          <button class="secondary" id="refreshKeys" type="button" data-i18n="refresh">Refresh</button>
        </div>
        <div class="resourceList" id="keys"></div>
      </section>

      <section class="panel adminOnly">
        <div class="panelHeader">
          <div class="panelTitle">
            <h2 data-i18n="users">Users</h2>
            <p class="muted" data-i18n="usersSubtitle">Registered accounts and API key prefixes.</p>
          </div>
          <button class="secondary" id="refreshUsers" type="button" data-i18n="refresh">Refresh</button>
        </div>
        <div class="resourceList" id="users"></div>
      </section>

      <section class="panel adminOnly">
        <div class="panelHeader">
          <div class="panelTitle">
            <h2 data-i18n="invites">Invites</h2>
            <p class="muted" data-i18n="invitesSubtitle">Registration codes, usage count, and revocation state.</p>
          </div>
          <button class="secondary" id="refreshInvites" type="button" data-i18n="refresh">Refresh</button>
        </div>
        <div class="resourceList" id="invites"></div>
      </section>
    </section>
  </main>

  <div class="toast" id="toast" role="status"></div>

  <script>
    const state = {
      signedIn: false,
      language: "en",
      role: "none",
      session: null,
      users: [],
      invites: [],
      devices: [],
      keys: [],
      loading: false
    };

    const translations = {
      en: {
        account: "Account",
        accountCreated: "Account created",
        accountSubtitle: "Current Relay console session.",
        active: "Active",
        activeDevices: "Active devices",
        alreadyHaveAccount: "Already have an account?",
        admin: "Admin",
        adminAccessNote: "Administrator access can manage users, invite codes, direct API keys, and all connected devices.",
        adminCreateApiKeySubtitle: "Provision a direct key without registration for local testing.",
        adminProtected: "Admin protected",
        administrator: "Administrator",
        apiKey: "API key",
        apiKeyCopied: "API key copied",
        apiKeyCreated: "API key created",
        apiKeyPrefix: "API key prefix",
        apiKeyPrefixCopied: "API key prefix copied",
        apiKeys: "API keys",
        apiKeysSubtitle: "Active key prefixes for your account. Full keys are shown only when created.",
        authFactAdmin: "Administrators create and revoke invite codes after signing in.",
        authFactInvite: "New users register with an invite code.",
        authFactKey: "API keys are shown in full only at creation time.",
        authIntroBody: "Use a Relay account to manage your own API keys and connected devices. The account configured in",
        authIntroBodySuffix: "signs in with administrator permissions.",
        authIntroTitle: "Sign in to your control console.",
        brandSubtitle: "Remote access, account sessions, API keys, and device presence.",
        checkingSession: "Checking session",
        chooseUsername: "Choose a username",
        connectedDevices: "Connected devices",
        connectedDevicesAdminSubtitle: "Desktop and mobile peers currently known to this relay.",
        connectedDevicesUserSubtitle: "Desktop and mobile peers currently connected with your account.",
        confirmPassword: "Confirm password",
        copy: "Copy",
        copyFailed: "Copy failed",
        createAccount: "Create account",
        createApiKey: "Create API key",
        createInvite: "Create invite",
        createInviteSubtitle: "Issue registration codes for new users.",
        createOwnApiKeySubtitle: "Generate a key for desktop and mobile clients.",
        createPassword: "Create a password",
        created: "Created",
        currentSession: "Current session",
        desktop: "Desktop",
        desktopAndMobile: "Desktop and mobile",
        desktopOnline: "Desktop online",
        developmentMode: "Development mode",
        expires: "Expires",
        expiresAt: "Expires at",
        exhausted: "Exhausted",
        expired: "Expired",
        fetchingRelayData: "Fetching relay data...",
        hidden: "hidden",
        inviteCode: "Invite code",
        inviteCodeCopied: "Invite code copied",
        inviteCreated: "Invite created",
        errorAdminNoKeys: "Admin accounts do not use relay API keys.",
        errorInvalidCredentials: "Invalid credentials.",
        errorInvalidInvite: "Invalid invite code.",
        errorInviteExpired: "Invite has expired.",
        errorInviteRequired: "Invite code is required.",
        errorInviteRevoked: "Invite has been revoked.",
        errorInviteUsed: "Invite has already been used.",
        errorNameRequired: "Name is required.",
        errorPasswordRequired: "Password is required.",
        errorSignedOut: "Not signed in.",
        errorUsernamePasswordRequired: "Username and password are required.",
        errorUsernameRequired: "Username is required.",
        invites: "Invites",
        invitesSubtitle: "Registration codes, usage count, and revocation state.",
        keyName: "Key name",
        knownDeviceRoom: "{count} known device room",
        knownDeviceRooms: "{count} known device rooms",
        lastSeen: "Last seen",
        lastUsed: "Last used",
        leaveBlankGenerate: "Leave blank to generate",
        loadingApiKeys: "Loading API keys",
        loadingDevices: "Loading devices",
        loadingInvites: "Loading invites",
        loadingUsers: "Loading users",
        maxUses: "Max uses",
        missing: "missing",
        mobile: "Mobile",
        noAccountYet: "No account yet?",
        noActiveInviteCodes: "No active invite codes",
        noActiveKeys: "No active keys",
        noActiveKeysLoaded: "No active keys loaded",
        never: "never",
        noApiKeys: "No API keys yet",
        noApiKeysDetail: "Create a key before connecting desktop or mobile clients.",
        noConnectedDevices: "No connected devices",
        noConnectedDevicesDetail: "Start the desktop app with the same endpoint and API key.",
        noDesktopPeers: "No desktop peers online",
        noInvites: "No invites yet",
        noInvitesDetail: "Create an invite code for browser or mobile registration.",
        noUsers: "No users yet",
        noUsersDetail: "Create an API key or invite a user to start connecting devices.",
        password: "Password",
        passwordMismatch: "Passwords do not match.",
        passwordPlaceholder: "Password",
        prefix: "Prefix",
        refresh: "Refresh",
        register: "Register",
        registerHelp: "Create an account with an invite code from an administrator.",
        registerWithInvite: "Register with invite code",
        relayAccess: "Relay access",
        repeatPassword: "Repeat the password",
        revoked: "Revoked",
        revoke: "Revoke",
        signedIn: "Signed in",
        signedInAs: "Signed in as {name}.",
        signedOut: "Signed out",
        signedOutMessage: "Signed out on this browser.",
        signIn: "Sign in",
        signInHelp: "Enter your account credentials to continue.",
        signInInstead: "Sign in instead",
        signInOrRegister: "Sign in or register to open the Relay console.",
        signOut: "Sign out",
        totalAccount: "{count} total account",
        totalAccounts: "{count} total accounts",
        totalInvite: "{count} total invite",
        totalInvites: "{count} total invites",
        totalKey: "{count} total key",
        totalKeys: "{count} total keys",
        unknown: "unknown",
        unknownUser: "unknown user",
        user: "User",
        userAccessNote: "User access can manage personal API keys and view devices connected with those keys.",
        userName: "User name",
        userNameExample: "e.g. three",
        userRevoked: "User revoked",
        username: "Username",
        usernamePlaceholder: "Username",
        usedCount: "Used {used} / {max}",
        users: "Users",
        usersSubtitle: "Registered accounts and API key prefixes.",
        valueCopied: "Value copied",
        waiting: "Waiting",
        welcomeTitle: "Welcome to Codex+ Relay"
      },
      zh: {
        account: "账户",
        accountCreated: "账户已创建",
        accountSubtitle: "当前 Relay 控制台会话。",
        active: "有效",
        activeDevices: "在线设备",
        alreadyHaveAccount: "已有账户？",
        admin: "管理员",
        adminAccessNote: "管理员可以管理用户、邀请码、直建 API key 和全部连接设备。",
        adminCreateApiKeySubtitle: "为本地测试直接创建一个 API key，无需注册流程。",
        adminProtected: "管理员保护已启用",
        administrator: "管理员",
        apiKey: "API key",
        apiKeyCopied: "API key 已复制",
        apiKeyCreated: "API key 已创建",
        apiKeyPrefix: "API key 前缀",
        apiKeyPrefixCopied: "API key 前缀已复制",
        apiKeys: "API keys",
        apiKeysSubtitle: "当前账户的 API key 前缀。完整 key 只会在创建时显示。",
        authFactAdmin: "管理员登录后可以创建和撤销邀请码。",
        authFactInvite: "新用户需要邀请码才能注册。",
        authFactKey: "完整 API key 只在创建时显示一次。",
        authIntroBody: "使用 Relay 账户管理自己的 API key 和连接设备；",
        authIntroBodySuffix: "中配置的账户将以管理员权限登录。",
        authIntroTitle: "登录进入控制台。",
        brandSubtitle: "远程访问、账户会话、API key 与设备在线状态。",
        checkingSession: "正在检查会话",
        chooseUsername: "设置用户名",
        connectedDevices: "连接设备",
        connectedDevicesAdminSubtitle: "当前 Relay 已知的桌面端和移动端连接。",
        connectedDevicesUserSubtitle: "当前账户下连接的桌面端和移动端。",
        confirmPassword: "确认密码",
        copy: "复制",
        copyFailed: "复制失败",
        createAccount: "创建账户",
        createApiKey: "创建 API key",
        createInvite: "创建邀请码",
        createInviteSubtitle: "为新用户发放注册码。",
        createOwnApiKeySubtitle: "为桌面端和移动端生成一个 API key。",
        createPassword: "创建密码",
        created: "创建于",
        currentSession: "当前会话",
        desktop: "桌面端",
        desktopAndMobile: "桌面端和移动端",
        desktopOnline: "桌面端在线",
        developmentMode: "开发模式",
        expires: "过期于",
        expiresAt: "过期时间",
        exhausted: "已用完",
        expired: "已过期",
        fetchingRelayData: "正在获取 Relay 数据...",
        hidden: "已隐藏",
        inviteCode: "邀请码",
        inviteCodeCopied: "邀请码已复制",
        inviteCreated: "邀请码已创建",
        errorAdminNoKeys: "管理员账户不使用 Relay API key。",
        errorInvalidCredentials: "用户名或密码错误。",
        errorInvalidInvite: "邀请码无效。",
        errorInviteExpired: "邀请码已过期。",
        errorInviteRequired: "请输入邀请码。",
        errorInviteRevoked: "邀请码已撤销。",
        errorInviteUsed: "邀请码已被使用完。",
        errorNameRequired: "请输入名称。",
        errorPasswordRequired: "请输入密码。",
        errorSignedOut: "未登录。",
        errorUsernamePasswordRequired: "请输入用户名和密码。",
        errorUsernameRequired: "请输入用户名。",
        invites: "邀请码",
        invitesSubtitle: "注册码、使用次数和撤销状态。",
        keyName: "Key 名称",
        knownDeviceRoom: "共 {count} 个设备房间",
        knownDeviceRooms: "共 {count} 个设备房间",
        lastSeen: "最后在线",
        lastUsed: "最后使用",
        leaveBlankGenerate: "留空则自动生成",
        loadingApiKeys: "正在加载 API keys",
        loadingDevices: "正在加载设备",
        loadingInvites: "正在加载邀请码",
        loadingUsers: "正在加载用户",
        maxUses: "最大使用次数",
        missing: "缺失",
        mobile: "移动端",
        noAccountYet: "还没有账户？",
        noActiveInviteCodes: "没有有效邀请码",
        noActiveKeys: "没有有效 key",
        noActiveKeysLoaded: "没有加载有效 key",
        never: "从未",
        noApiKeys: "还没有 API key",
        noApiKeysDetail: "连接桌面端或移动端前先创建一个 key。",
        noConnectedDevices: "没有连接设备",
        noConnectedDevicesDetail: "使用相同 endpoint 和 API key 启动桌面端。",
        noDesktopPeers: "没有桌面端在线",
        noInvites: "还没有邀请码",
        noInvitesDetail: "创建一个邀请码用于浏览器或移动端注册。",
        noUsers: "还没有用户",
        noUsersDetail: "创建 API key 或邀请用户后即可连接设备。",
        password: "密码",
        passwordMismatch: "两次输入的密码不一致。",
        passwordPlaceholder: "密码",
        prefix: "前缀",
        refresh: "刷新",
        register: "注册",
        registerHelp: "使用管理员发放的邀请码创建账户。",
        registerWithInvite: "使用邀请码注册",
        relayAccess: "Relay 访问",
        repeatPassword: "再次输入密码",
        revoked: "已撤销",
        revoke: "撤销",
        signedIn: "已登录",
        signedInAs: "已登录为 {name}。",
        signedOut: "未登录",
        signedOutMessage: "已在此浏览器退出登录。",
        signIn: "登录",
        signInHelp: "输入账户凭据继续。",
        signInInstead: "改为登录",
        signInOrRegister: "登录或注册后进入 Relay 控制台。",
        signOut: "退出登录",
        totalAccount: "共 {count} 个账户",
        totalAccounts: "共 {count} 个账户",
        totalInvite: "共 {count} 个邀请码",
        totalInvites: "共 {count} 个邀请码",
        totalKey: "共 {count} 个 key",
        totalKeys: "共 {count} 个 key",
        unknown: "未知",
        unknownUser: "未知用户",
        user: "用户",
        userAccessNote: "用户可以管理个人 API key，并查看通过这些 key 连接的设备。",
        userName: "用户名",
        userNameExample: "例如 three",
        userRevoked: "用户已撤销",
        username: "用户名",
        usernamePlaceholder: "用户名",
        usedCount: "已用 {used} / {max}",
        users: "用户",
        usersSubtitle: "已注册账户和 API key 前缀。",
        valueCopied: "已复制",
        waiting: "等待连接",
        welcomeTitle: "欢迎使用 Codex+ Relay"
      }
    };

    const usernameInput = document.querySelector("#loginUsername");
    const passwordInput = document.querySelector("#loginPassword");
    const loginForm = document.querySelector("#loginForm");
    const registerForm = document.querySelector("#registerForm");
    const loginMessage = document.querySelector("#loginMessage");
    const registerMessage = document.querySelector("#registerMessage");
    const loginModeButton = document.querySelector("#loginModeButton");
    const registerModeButton = document.querySelector("#registerModeButton");
    const authModeHelp = document.querySelector("#authModeHelp");
    const authSwitchText = document.querySelector("#authSwitchText");
    const authSwitchButton = document.querySelector("#authSwitchButton");
    const formMessage = document.querySelector("#formMessage");
    const inviteMessage = document.querySelector("#inviteMessage");
    const currentKeyMessage = document.querySelector("#currentKeyMessage");
    const sessionPill = document.querySelector("#sessionPill");
    const toast = document.querySelector("#toast");
    const languageEn = document.querySelector("#languageEn");
    const languageZh = document.querySelector("#languageZh");

    state.language = preferredLanguage();
    usernameInput.value = localStorage.getItem("codepRelayUsername") || "";

    function preferredLanguage() {
      const saved = localStorage.getItem("codepRelayLanguage");
      if (saved === "zh" || saved === "en") return saved;
      return navigator.language && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
    }

    function t(key, values = {}) {
      const table = translations[state.language] || translations.en;
      const template = table[key] || translations.en[key] || key;
      return String(template).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
    }

    function errorText(error) {
      const message = String(error && error.message ? error.message : error || "");
      const keyByMessage = {
        "admin accounts do not use relay API keys": "errorAdminNoKeys",
        "invalid credentials": "errorInvalidCredentials",
        "invalid invite code": "errorInvalidInvite",
        "invite code is required": "errorInviteRequired",
        "invite has already been used": "errorInviteUsed",
        "invite has been revoked": "errorInviteRevoked",
        "invite has expired": "errorInviteExpired",
        "name is required": "errorNameRequired",
        "not signed in": "errorSignedOut",
        "password is required": "errorPasswordRequired",
        "username and password are required": "errorUsernamePasswordRequired",
        "username is required": "errorUsernameRequired"
      };
      return keyByMessage[message.toLowerCase()] ? t(keyByMessage[message.toLowerCase()]) : message;
    }

    function countText(count, singularKey, pluralKey) {
      return t(count === 1 ? singularKey : pluralKey, { count });
    }

    function applyLanguage() {
      document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
      document.body.dataset.language = state.language;
      document.querySelectorAll("[data-i18n]").forEach(node => {
        node.textContent = t(node.dataset.i18n);
      });
      document.querySelectorAll("[data-i18n-placeholder]").forEach(node => {
        node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
      });
      const protectionPill = document.querySelector("#protectionPill");
      document.querySelector("#protectionPillText").textContent =
        protectionPill.dataset.protected === "true" ? t("adminProtected") : t("developmentMode");
      setAuthMode(document.body.dataset.authMode || "login", { focus: false, clearMessages: false });
      renderAuth();
      renderVisibleData();
    }

    function setLanguage(language) {
      state.language = language === "zh" ? "zh" : "en";
      localStorage.setItem("codepRelayLanguage", state.language);
      applyLanguage();
    }

    function headers() {
      return { "Content-Type": "application/json" };
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        credentials: "same-origin",
        headers: { ...headers(), ...(options.headers || {}) }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || response.statusText);
      return body;
    }

    function escapeHTML(value) {
      return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
    }

    function formatTime(value) {
      if (!value) return t("never");
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return t("unknown");
      return date.toLocaleString(state.language === "zh" ? "zh-CN" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    function inviteStatus(invite) {
      if (invite.revoked_at) return { text: t("revoked"), tone: "danger" };
      if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return { text: t("expired"), tone: "danger" };
      if (invite.max_uses > 0 && invite.used_count >= invite.max_uses) return { text: t("exhausted"), tone: "warning" };
      return { text: t("active"), tone: "success" };
    }

    function userStatus(user) {
      return user.revoked_at ? { text: t("revoked"), tone: "danger" } : { text: t("active"), tone: "success" };
    }

    function setMessage(node, text, tone) {
      node.dataset.visible = text ? "true" : "false";
      node.classList.toggle("error", tone === "error");
      node.classList.toggle("success", tone === "success");
      node.innerHTML = text || "";
    }

    function setAuthMode(mode, options = {}) {
      const nextMode = mode === "register" ? "register" : "login";
      const shouldFocus = options.focus !== false;
      const shouldClearMessages = options.clearMessages !== false;
      document.body.dataset.authMode = nextMode;
      loginModeButton.setAttribute("aria-selected", nextMode === "login" ? "true" : "false");
      registerModeButton.setAttribute("aria-selected", nextMode === "register" ? "true" : "false");
      authModeHelp.textContent = nextMode === "login" ? t("signInHelp") : t("registerHelp");
      authSwitchText.textContent = nextMode === "login" ? t("noAccountYet") : t("alreadyHaveAccount");
      authSwitchButton.textContent = nextMode === "login" ? t("registerWithInvite") : t("signInInstead");
      if (shouldClearMessages) {
        setMessage(loginMessage, "", "");
        setMessage(registerMessage, "", "");
      }
      if (nextMode === "login" && shouldFocus) {
        usernameInput.focus();
      } else if (shouldFocus) {
        document.querySelector("#registerUsername").focus();
      }
    }

    function showToast(text) {
      toast.textContent = text;
      toast.dataset.visible = "true";
      window.clearTimeout(showToast.timeout);
      showToast.timeout = window.setTimeout(() => {
        toast.dataset.visible = "false";
      }, 1800);
    }

    async function copyText(value, label) {
      try {
        await navigator.clipboard.writeText(value);
        showToast(label || t("valueCopied"));
      } catch (error) {
        showToast(t("copyFailed"));
      }
    }

    function renderAuth() {
      document.body.dataset.role = state.role || "none";
      document.body.dataset.auth = state.signedIn ? "signed-in" : "signed-out";
      sessionPill.textContent = state.signedIn ? (state.role === "admin" ? t("admin") : t("signedIn")) : t("signedOut");
      sessionPill.className = "pill " + (state.signedIn ? "success" : "warning");
      document.querySelector("#signedInName").textContent = state.session && state.session.username ? state.session.username : t("signedOut");
      document.querySelector("#rolePill").textContent = state.role === "admin" ? t("administrator") : t("user");
      document.querySelector("#signOut").style.display = state.signedIn ? "inline-flex" : "none";
      if (!state.signedIn) {
        state.role = "none";
        document.body.dataset.role = "none";
      }
      renderMetrics();
    }

    function renderMetrics() {
      const activeUsers = state.users.filter(user => !user.revoked_at).length;
      const activeInvites = state.invites.filter(invite => inviteStatus(invite).tone === "success").length;
      const onlineDevices = state.devices.filter(device => device.connected).length;
      const activeKeys = state.keys.filter(key => !key.revoked_at).length;

      document.querySelector("#deviceMetric").textContent = String(onlineDevices);
      document.querySelector("#deviceMetricHint").textContent = state.devices.length
        ? countText(state.devices.length, "knownDeviceRoom", "knownDeviceRooms")
        : t("noDesktopPeers");
      const userMetric = document.querySelector("#userMetric");
      if (userMetric) {
        userMetric.textContent = String(activeUsers);
        document.querySelector("#userMetricHint").textContent = state.users.length
          ? countText(state.users.length, "totalAccount", "totalAccounts")
          : t("noActiveKeysLoaded");
      }
      const keyMetric = document.querySelector("#keyMetric");
      if (keyMetric) {
        keyMetric.textContent = String(activeKeys);
        document.querySelector("#keyMetricHint").textContent = state.keys.length
          ? countText(state.keys.length, "totalKey", "totalKeys")
          : t("noActiveKeys");
      }
      const inviteMetric = document.querySelector("#inviteMetric");
      if (inviteMetric) {
        inviteMetric.textContent = String(activeInvites);
        document.querySelector("#inviteMetricHint").textContent = state.invites.length
          ? countText(state.invites.length, "totalInvite", "totalInvites")
          : t("noActiveInviteCodes");
      }
    }

    function renderLoading(selector, label) {
      document.querySelector(selector).innerHTML =
        '<div class="empty"><strong>' + escapeHTML(label) + '</strong><span>' + escapeHTML(t("fetchingRelayData")) + '</span></div>';
    }

    function renderEmpty(selector, title, detail) {
      document.querySelector(selector).innerHTML =
        '<div class="empty"><strong>' + escapeHTML(title) + '</strong><span>' + escapeHTML(detail) + '</span></div>';
    }

    function statusPill(status) {
      return '<span class="pill ' + status.tone + '"><span class="statusDot"></span>' + escapeHTML(status.text) + '</span>';
    }

    function renderUsers() {
      const target = document.querySelector("#users");
      if (!state.users.length) {
        renderEmpty("#users", t("noUsers"), t("noUsersDetail"));
        return;
      }
      target.innerHTML = state.users.map(user => {
        const status = userStatus(user);
        const key = user.api_key || user.api_key_prefix || t("hidden");
        return '<article class="resourceItem">' +
          '<div class="resourceMain">' +
          '<div class="resourceTitle"><span class="truncate">' + escapeHTML(user.name) + '</span>' + statusPill(status) + '</div>' +
          '<div class="resourceMeta"><span class="mono">' + escapeHTML(user.id) + '</span><span>' + escapeHTML(t("created")) + ' ' + escapeHTML(formatTime(user.created_at)) + '</span></div>' +
          '<div class="tokenBox"><span class="mono">' + escapeHTML(key) + '</span><button class="ghost" type="button" data-copy="' + escapeHTML(key) + '" data-copy-label-key="apiKeyPrefix">' + escapeHTML(t("copy")) + '</button></div>' +
          '</div>' +
          '<div class="tableActions">' +
          (user.revoked_at ? '' : '<button class="danger" type="button" data-revoke="' + escapeHTML(user.id) + '">' + escapeHTML(t("revoke")) + '</button>') +
          '</div>' +
          '</article>';
      }).join("");
    }

    function renderKeys() {
      const target = document.querySelector("#keys");
      if (!target) return;
      if (!state.keys.length) {
        renderEmpty("#keys", t("noApiKeys"), t("noApiKeysDetail"));
        return;
      }
      target.innerHTML = state.keys.map(key => {
        const status = key.revoked_at ? { text: t("revoked"), tone: "danger" } : { text: t("active"), tone: "success" };
        return '<article class="resourceItem">' +
          '<div class="resourceMain">' +
          '<div class="resourceTitle"><span class="truncate">' + escapeHTML(key.name || "default") + '</span>' + statusPill(status) + '</div>' +
          '<div class="resourceMeta"><span class="mono">' + escapeHTML(key.id) + '</span><span>' + escapeHTML(t("prefix")) + ' ' + escapeHTML(key.key_prefix || t("hidden")) + '</span><span>' + escapeHTML(t("created")) + ' ' + escapeHTML(formatTime(key.created_at)) + '</span></div>' +
          (key.last_used_at ? '<div class="muted">' + escapeHTML(t("lastUsed")) + ' ' + escapeHTML(formatTime(key.last_used_at)) + '</div>' : '') +
          '</div>' +
          '</article>';
      }).join("");
    }

    function renderInvites() {
      const target = document.querySelector("#invites");
      if (!state.invites.length) {
        renderEmpty("#invites", t("noInvites"), t("noInvitesDetail"));
        return;
      }
      target.innerHTML = state.invites.map(invite => {
        const status = inviteStatus(invite);
        const usedText = t("usedCount", { used: invite.used_count, max: invite.max_uses });
        return '<article class="resourceItem">' +
          '<div class="resourceMain">' +
          '<div class="resourceTitle"><span class="truncate">' + escapeHTML(invite.code_hint) + '</span>' + statusPill(status) + '</div>' +
          '<div class="resourceMeta"><span class="mono">' + escapeHTML(invite.id) + '</span><span>' + escapeHTML(usedText) + '</span><span>' + escapeHTML(t("created")) + ' ' + escapeHTML(formatTime(invite.created_at)) + '</span></div>' +
          (invite.expires_at ? '<div class="muted">' + escapeHTML(t("expires")) + ' ' + escapeHTML(formatTime(invite.expires_at)) + '</div>' : '') +
          '</div>' +
          '<div class="tableActions">' +
          (invite.revoked_at ? '' : '<button class="danger" type="button" data-revoke-invite="' + escapeHTML(invite.id) + '">' + escapeHTML(t("revoke")) + '</button>') +
          '</div>' +
          '</article>';
      }).join("");
    }

    function renderDevices() {
      const target = document.querySelector("#devices");
      if (!state.devices.length) {
        renderEmpty("#devices", t("noConnectedDevices"), t("noConnectedDevicesDetail"));
        return;
      }
      target.innerHTML = state.devices.map(device => {
        const status = device.connected ? { text: t("desktopOnline"), tone: "success" } : { text: t("waiting"), tone: "warning" };
        return '<article class="resourceItem">' +
          '<div class="resourceMain">' +
          '<div class="resourceTitle"><span class="truncate">' + escapeHTML(device.device_id) + '</span>' + statusPill(status) + '</div>' +
          '<div class="resourceMeta"><span>' + escapeHTML(device.user_name || device.user_id || t("unknownUser")) + '</span><span>' + escapeHTML(t("desktop")) + ' ' + device.desktop_count + '</span><span>' + escapeHTML(t("mobile")) + ' ' + device.client_count + '</span><span>' + escapeHTML(t("lastSeen")) + ' ' + escapeHTML(formatTime(device.last_seen)) + '</span></div>' +
          '</div>' +
          '<div class="tableActions">' +
          '<span class="pill">' + escapeHTML((device.relay_transports || ["websocket"]).join(", ")) + '</span>' +
          '</div>' +
          '</article>';
      }).join("");
    }

    async function loadUsers() {
      if (!state.signedIn || state.role !== "admin") return;
      renderLoading("#users", t("loadingUsers"));
      try {
        const body = await api("/api/users");
        state.users = body.users || [];
        renderUsers();
        renderMetrics();
      } catch (error) {
        document.querySelector("#users").innerHTML = '<div class="empty"><strong class="error">' + escapeHTML(errorText(error)) + '</strong></div>';
      }
    }

    async function loadInvites() {
      if (!state.signedIn || state.role !== "admin") return;
      renderLoading("#invites", t("loadingInvites"));
      try {
        const body = await api("/api/invites");
        state.invites = body.invites || [];
        renderInvites();
        renderMetrics();
      } catch (error) {
        document.querySelector("#invites").innerHTML = '<div class="empty"><strong class="error">' + escapeHTML(errorText(error)) + '</strong></div>';
      }
    }

    async function loadDevices() {
      if (!state.signedIn) return;
      renderLoading("#devices", t("loadingDevices"));
      try {
        const body = await api(state.role === "admin" ? "/api/devices" : "/api/auth/devices");
        state.devices = body.devices || [];
        renderDevices();
        renderMetrics();
      } catch (error) {
        document.querySelector("#devices").innerHTML = '<div class="empty"><strong class="error">' + escapeHTML(errorText(error)) + '</strong></div>';
      }
    }

    async function loadMe() {
      const body = await api("/api/auth/me");
      applySession(body.session);
      return body.session;
    }

    async function loadKeys() {
      if (!state.signedIn || state.role !== "user") return;
      renderLoading("#keys", t("loadingApiKeys"));
      try {
        const session = await loadMe();
        state.keys = session && session.api_keys ? session.api_keys : [];
        renderKeys();
        renderMetrics();
      } catch (error) {
        document.querySelector("#keys").innerHTML = '<div class="empty"><strong class="error">' + escapeHTML(errorText(error)) + '</strong></div>';
      }
    }

    async function loadAll() {
      if (!state.signedIn) return;
      if (state.role === "admin") {
        await Promise.all([loadDevices(), loadUsers(), loadInvites()]);
      } else {
        await Promise.all([loadDevices(), loadKeys()]);
      }
    }

    function toRFC3339FromLocalInput(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toISOString();
    }

    function applySession(session) {
      state.session = session || null;
      state.signedIn = !!session;
      state.role = session && session.role ? session.role : "none";
      state.keys = session && session.api_keys ? session.api_keys : [];
      renderAuth();
      if (state.role === "user") {
        renderKeys();
      }
    }

    function renderVisibleData() {
      if (!state.signedIn) return;
      renderDevices();
      if (state.role === "admin") {
        renderUsers();
        renderInvites();
      } else if (state.role === "user") {
        renderKeys();
      }
    }

    loginForm.addEventListener("submit", async event => {
      event.preventDefault();
      setMessage(loginMessage, "", "");
      try {
        const body = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            username: usernameInput.value.trim(),
            password: passwordInput.value
          })
        });
        localStorage.setItem("codepRelayUsername", usernameInput.value.trim());
        passwordInput.value = "";
        applySession(body.session);
        setMessage(loginMessage, escapeHTML(t("signedInAs", { name: state.session.username })), "success");
        await loadAll();
      } catch (error) {
        setMessage(loginMessage, escapeHTML(errorText(error)), "error");
      }
    });

    registerForm.addEventListener("submit", async event => {
      event.preventDefault();
      setMessage(registerMessage, "", "");
      const password = document.querySelector("#registerPassword").value;
      const confirmPassword = document.querySelector("#registerPasswordConfirm").value;
      if (password !== confirmPassword) {
        setMessage(registerMessage, escapeHTML(t("passwordMismatch")), "error");
        return;
      }
      try {
        const body = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            username: document.querySelector("#registerUsername").value.trim(),
            password,
            invite_code: document.querySelector("#registerInviteCode").value.trim()
          })
        });
        applySession(body.session);
        document.querySelector("#registerPassword").value = "";
        document.querySelector("#registerPasswordConfirm").value = "";
        const key = body.api_key || "";
        setMessage(currentKeyMessage,
          '<div class="stack"><strong>' + escapeHTML(t("accountCreated")) + '</strong><div class="tokenBox"><span class="mono">' + escapeHTML(key) + '</span><button class="ghost" type="button" data-copy="' + escapeHTML(key) + '" data-copy-label-key="apiKey">' + escapeHTML(t("copy")) + '</button></div></div>',
          "success");
        await loadAll();
      } catch (error) {
        setMessage(registerMessage, escapeHTML(errorText(error)), "error");
      }
    });

    document.querySelector("#signOut").addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" }).catch(() => ({}));
      passwordInput.value = "";
      state.signedIn = false;
      state.role = "none";
      state.session = null;
      state.users = [];
      state.invites = [];
      state.devices = [];
      state.keys = [];
      renderAuth();
      setAuthMode("login");
      setMessage(loginMessage, escapeHTML(t("signedOutMessage")), "");
    });

    loginModeButton.addEventListener("click", () => setAuthMode("login"));
    registerModeButton.addEventListener("click", () => setAuthMode("register"));
    authSwitchButton.addEventListener("click", () => {
      setAuthMode(document.body.dataset.authMode === "login" ? "register" : "login");
    });
    languageEn.addEventListener("click", () => setLanguage("en"));
    languageZh.addEventListener("click", () => setLanguage("zh"));

    document.querySelector("#createInvite").addEventListener("click", async () => {
      setMessage(inviteMessage, "", "");
      try {
        const body = await api("/api/invites", {
          method: "POST",
          body: JSON.stringify({
            max_uses: Number(document.querySelector("#inviteMaxUses").value || "1"),
            expires_at: toRFC3339FromLocalInput(document.querySelector("#inviteExpiresAt").value)
          })
        });
        const code = body.code || "";
        setMessage(inviteMessage,
          '<div class="stack"><strong>' + escapeHTML(t("inviteCreated")) + '</strong><div class="tokenBox"><span class="mono">' + escapeHTML(code) + '</span><button class="ghost" type="button" data-copy="' + escapeHTML(code) + '" data-copy-label-key="inviteCode">' + escapeHTML(t("copy")) + '</button></div></div>',
          "success");
        await loadInvites();
      } catch (error) {
        setMessage(inviteMessage, escapeHTML(errorText(error)), "error");
      }
    });

    document.querySelector("#createCurrentKey").addEventListener("click", async () => {
      setMessage(currentKeyMessage, "", "");
      try {
        const body = await api("/api/auth/api-keys", {
          method: "POST",
          body: JSON.stringify({
            name: document.querySelector("#currentKeyName").value
          })
        });
        const key = body.api_key || "";
        setMessage(currentKeyMessage,
          '<div class="stack"><strong>' + escapeHTML(t("apiKeyCreated")) + '</strong><div class="tokenBox"><span class="mono">' + escapeHTML(key) + '</span><button class="ghost" type="button" data-copy="' + escapeHTML(key) + '" data-copy-label-key="apiKey">' + escapeHTML(t("copy")) + '</button></div></div>',
          "success");
        document.querySelector("#currentKeyName").value = "";
        await loadKeys();
      } catch (error) {
        setMessage(currentKeyMessage, escapeHTML(errorText(error)), "error");
      }
    });

    document.querySelector("#createUser").addEventListener("click", async () => {
      setMessage(formMessage, "", "");
      try {
        const body = await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            name: document.querySelector("#userName").value,
            api_key: document.querySelector("#apiKey").value
          })
        });
        const key = body.user && body.user.api_key ? body.user.api_key : "";
        setMessage(formMessage,
          '<div class="stack"><strong>' + escapeHTML(t("apiKeyCreated")) + '</strong><div class="tokenBox"><span class="mono">' + escapeHTML(key) + '</span><button class="ghost" type="button" data-copy="' + escapeHTML(key) + '" data-copy-label-key="apiKey">' + escapeHTML(t("copy")) + '</button></div></div>',
          "success");
        document.querySelector("#apiKey").value = "";
        await loadUsers();
      } catch (error) {
        setMessage(formMessage, escapeHTML(errorText(error)), "error");
      }
    });

    document.body.addEventListener("click", async event => {
      const copyButton = event.target.closest("[data-copy]");
      if (copyButton) {
        const labelKey = copyButton.getAttribute("data-copy-label-key");
        await copyText(copyButton.getAttribute("data-copy") || "", labelKey ? t(labelKey + "Copied") : t("valueCopied"));
        return;
      }

      const userID = event.target.getAttribute("data-revoke");
      if (userID) {
        await api("/api/users/" + encodeURIComponent(userID), { method: "DELETE" });
        await loadUsers();
        showToast(t("userRevoked"));
        return;
      }

      const inviteID = event.target.getAttribute("data-revoke-invite");
      if (inviteID) {
        await api("/api/invites/" + encodeURIComponent(inviteID), { method: "DELETE" });
        await loadInvites();
        showToast("Invite revoked");
      }
    });

    document.querySelector("#refreshAll").addEventListener("click", loadAll);
    document.querySelector("#refreshUsers").addEventListener("click", loadUsers);
    document.querySelector("#refreshInvites").addEventListener("click", loadInvites);
    document.querySelector("#refreshDevices").addEventListener("click", loadDevices);
    document.querySelector("#refreshKeys").addEventListener("click", loadKeys);

    applyLanguage();

    api("/api/auth/me").then(body => {
      applySession(body.session);
      setMessage(loginMessage, escapeHTML(t("signedInAs", { name: state.session.username })), "success");
      loadAll();
    }).catch(() => {
      state.signedIn = false;
      state.role = "none";
      renderAuth();
      setMessage(loginMessage, escapeHTML(t("signInOrRegister")), "");
    });
  </script>
</body>
</html>`))
