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
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type config struct {
	addr       string
	dataPath   string
	adminToken string
}

type server struct {
	cfg      config
	hub      *hub
	users    *userStore
	logger   *slog.Logger
	upgrader websocket.Upgrader
}

type userRecord struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	APIKey    string     `json:"api_key"`
	CreatedAt time.Time  `json:"created_at"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
}

type userStore struct {
	mu    sync.RWMutex
	path  string
	users map[string]userRecord
}

type userFile struct {
	Users []userRecord `json:"users"`
}

type hub struct {
	mu    sync.RWMutex
	rooms map[string]*room
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
	role     string
	userID   string
	userName string
	deviceID string
	conn     *websocket.Conn
	send     chan []byte
	hub      *hub
	logger   *slog.Logger
}

type relayEnvelope struct {
	Type     string          `json:"type"`
	UserID   string          `json:"user_id"`
	DeviceID string          `json:"device_id"`
	From     string          `json:"from"`
	SentAt   time.Time       `json:"sent_at"`
	Payload  json.RawMessage `json:"payload,omitempty"`
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

	users, err := newUserStore(cfg.dataPath)
	if err != nil {
		logger.Error("failed to open relay data", "error", err)
		os.Exit(1)
	}

	srv := newServer(cfg, users, logger)
	httpServer := &http.Server{
		Addr:              cfg.addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errs := make(chan error, 1)
	go func() {
		logger.Info("relay listening", "addr", cfg.addr, "data", cfg.dataPath)
		if cfg.adminToken == "" {
			logger.Warn("admin UI is not protected; set CODEP_RELAY_ADMIN_TOKEN before exposing this server")
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
	addr := flag.String("addr", envDefault("CODEP_RELAY_ADDR", "0.0.0.0:8909"), "HTTP listen address")
	dataPath := flag.String("data", envDefault("CODEP_RELAY_DATA", ".codep-relay.json"), "relay data JSON path")
	adminToken := flag.String("admin-token", os.Getenv("CODEP_RELAY_ADMIN_TOKEN"), "optional admin UI/API token")
	flag.Parse()
	return config{
		addr:       *addr,
		dataPath:   *dataPath,
		adminToken: *adminToken,
	}
}

func newServer(cfg config, users *userStore, logger *slog.Logger) *server {
	return &server{
		cfg:    cfg,
		hub:    newHub(),
		users:  users,
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
		"AdminProtected": s.cfg.adminToken != "",
	}); err != nil {
		panic(err)
	}
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

func (s *server) handleUsers(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid admin token"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users": s.users.list(),
	})
}

func (s *server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if !s.authorizedAdmin(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid admin token"})
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
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid admin token"})
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
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid admin token"})
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

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Warn("websocket upgrade failed", "role", role, "error", err)
		return
	}

	p := &peer{
		role:     role,
		userID:   user.ID,
		userName: user.Name,
		deviceID: deviceID,
		conn:     conn,
		send:     make(chan []byte, 32),
		hub:      s.hub,
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
	if s.cfg.adminToken == "" {
		return true
	}
	token := r.Header.Get("X-CodeP-Admin-Token")
	if token == "" {
		token = r.URL.Query().Get("admin_token")
	}
	return token == s.cfg.adminToken
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

func newUserStore(path string) (*userStore, error) {
	store := &userStore{
		path:  path,
		users: make(map[string]userRecord),
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *userStore) load() error {
	content, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}

	var data userFile
	if err := json.Unmarshal(content, &data); err != nil {
		return err
	}
	for _, user := range data.Users {
		s.users[user.ID] = user
	}
	return nil
}

func (s *userStore) saveLocked() error {
	users := make([]userRecord, 0, len(s.users))
	for _, user := range s.users {
		users = append(users, user)
	}

	content, err := json.MarshalIndent(userFile{Users: users}, "", "  ")
	if err != nil {
		return err
	}

	dir := filepath.Dir(s.path)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, content, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *userStore) list() []userRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	users := make([]userRecord, 0, len(s.users))
	for _, user := range s.users {
		users = append(users, user)
	}
	return users
}

func (s *userStore) create(name string, apiKey string) (userRecord, error) {
	name = strings.TrimSpace(name)
	apiKey = strings.TrimSpace(apiKey)
	if name == "" {
		return userRecord{}, errors.New("name is required")
	}
	if apiKey == "" {
		apiKey = "cp_" + randomHex(24)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, user := range s.users {
		if user.APIKey == apiKey && user.RevokedAt == nil {
			return userRecord{}, errors.New("api key already exists")
		}
	}

	user := userRecord{
		ID:        "usr_" + randomHex(10),
		Name:      name,
		APIKey:    apiKey,
		CreatedAt: time.Now().UTC(),
	}
	s.users[user.ID] = user
	if err := s.saveLocked(); err != nil {
		return userRecord{}, err
	}
	return user, nil
}

func (s *userStore) revoke(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	user, ok := s.users[id]
	if !ok {
		return errors.New("user not found")
	}
	now := time.Now().UTC()
	user.RevokedAt = &now
	s.users[id] = user
	return s.saveLocked()
}

func (s *userStore) authenticate(apiKey string) (userRecord, bool) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return userRecord{}, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, user := range s.users {
		if user.APIKey == apiKey && user.RevokedAt == nil {
			return user, true
		}
	}
	return userRecord{}, false
}

func newHub() *hub {
	return &hub{
		rooms: make(map[string]*room),
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
		p.hub.forward(p, payload)
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
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CodeP-Admin-Token, X-CodeP-Api-Key")
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
      --soft: #f6f7f9;
      --line: #d9dee7;
      --ink: #111827;
      --body: #374151;
      --muted: #6b7280;
      --primary: #151b24;
      --danger: #aa2d00;
      --success: #097a25;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--soft);
      color: var(--body);
      font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 20px 24px;
      border-bottom: 1px solid var(--line);
      background: var(--canvas);
    }
    h1, h2, p { margin: 0; }
    h1 { color: var(--ink); font-size: 22px; font-weight: 650; letter-spacing: 0; }
    h2 { color: var(--ink); font-size: 16px; font-weight: 650; }
    main {
      display: grid;
      grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
      gap: 16px;
      max-width: 1180px;
      margin: 0 auto;
      padding: 16px;
    }
    section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--canvas);
      padding: 16px;
    }
    .stack { display: flex; flex-direction: column; gap: 16px; }
    .muted { color: var(--muted); font-size: 12px; }
    label { display: grid; gap: 6px; color: var(--ink); font-size: 12px; font-weight: 650; }
    input {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 10px;
      color: var(--ink);
      background: var(--canvas);
      font: inherit;
    }
    button {
      min-height: 38px;
      border: 1px solid var(--primary);
      border-radius: 6px;
      padding: 0 12px;
      background: var(--primary);
      color: white;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }
    button.secondary { border-color: var(--line); background: var(--canvas); color: var(--ink); }
    button.danger { border-color: var(--danger); background: var(--danger); color: white; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .list { display: grid; gap: 10px; }
    .card {
      display: grid;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px;
      background: var(--canvas);
    }
    .card strong { color: var(--ink); }
    code {
      overflow-wrap: anywhere;
      border-radius: 4px;
      padding: 2px 4px;
      background: #eef1f5;
      color: var(--ink);
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    .pill {
      display: inline-flex;
      width: fit-content;
      min-height: 26px;
      align-items: center;
      border: 1px solid #9bd3a8;
      border-radius: 999px;
      padding: 0 10px;
      color: var(--success);
      background: #f5fff7;
      font-size: 12px;
      font-weight: 650;
    }
    .error { color: var(--danger); }
    @media (max-width: 760px) {
      main { grid-template-columns: 1fr; }
      header { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Codex+ Relay</h1>
      <p class="muted">Manage API keys for desktop and mobile clients.</p>
    </div>
    <span class="pill">{{if .AdminProtected}}Admin protected{{else}}Development mode{{end}}</span>
  </header>
  <main>
    <div class="stack">
      <section class="stack">
        <h2>Admin</h2>
        <label>
          Admin token
          <input id="adminToken" type="password" placeholder="Only needed when configured">
        </label>
        <button class="secondary" id="saveToken">Save token</button>
        <p class="muted">Set <code>CODEP_RELAY_ADMIN_TOKEN</code> on public servers.</p>
      </section>
      <section class="stack">
        <h2>Create user key</h2>
        <label>
          User name
          <input id="userName" placeholder="e.g. three">
        </label>
        <label>
          API key
          <input id="apiKey" placeholder="Leave blank to generate">
        </label>
        <button id="createUser">Create API key</button>
        <p id="formMessage" class="muted"></p>
      </section>
    </div>
    <div class="stack">
      <section class="stack">
        <div class="row">
          <h2>Users</h2>
          <button class="secondary" id="refreshUsers">Refresh</button>
        </div>
        <div class="list" id="users"></div>
      </section>
      <section class="stack">
        <div class="row">
          <h2>Connected devices</h2>
          <button class="secondary" id="refreshDevices">Refresh</button>
        </div>
        <div class="list" id="devices"></div>
      </section>
    </div>
  </main>
  <script>
    const tokenInput = document.querySelector("#adminToken");
    const formMessage = document.querySelector("#formMessage");
    tokenInput.value = localStorage.getItem("codepRelayAdminToken") || "";

    function headers() {
      const token = tokenInput.value.trim();
      return token ? { "Content-Type": "application/json", "X-CodeP-Admin-Token": token } : { "Content-Type": "application/json" };
    }

    async function api(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || response.statusText);
      return body;
    }

    function userCard(user) {
      const revoked = Boolean(user.revoked_at);
      return '<div class="card">' +
        '<div class="row"><strong>' + escapeHTML(user.name) + '</strong><span class="muted">' + escapeHTML(user.id) + '</span></div>' +
        '<div><code>' + escapeHTML(user.api_key) + '</code></div>' +
        '<div class="row"><span class="' + (revoked ? 'error' : 'muted') + '">' + (revoked ? 'Revoked' : 'Active') + '</span>' +
        (revoked ? '' : '<button class="danger" data-revoke="' + escapeHTML(user.id) + '">Revoke</button>') +
        '</div></div>';
    }

    function deviceCard(device) {
      return '<div class="card">' +
        '<div class="row"><strong>' + escapeHTML(device.device_id) + '</strong><span class="pill">' + (device.connected ? 'desktop online' : 'waiting') + '</span></div>' +
        '<p class="muted">' + escapeHTML(device.user_name) + ' · desktop ' + device.desktop_count + ' · mobile ' + device.client_count + '</p>' +
        '</div>';
    }

    async function loadUsers() {
      const target = document.querySelector("#users");
      target.innerHTML = '<p class="muted">Loading...</p>';
      try {
        const body = await api("/api/users");
        target.innerHTML = body.users.length ? body.users.map(userCard).join("") : '<p class="muted">No users yet.</p>';
      } catch (error) {
        target.innerHTML = '<p class="error">' + escapeHTML(error.message) + '</p>';
      }
    }

    async function loadDevices() {
      const target = document.querySelector("#devices");
      target.innerHTML = '<p class="muted">Loading...</p>';
      try {
        const body = await api("/api/devices");
        target.innerHTML = body.devices.length ? body.devices.map(deviceCard).join("") : '<p class="muted">No connected devices.</p>';
      } catch (error) {
        target.innerHTML = '<p class="error">' + escapeHTML(error.message) + '</p>';
      }
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

    document.querySelector("#saveToken").addEventListener("click", () => {
      localStorage.setItem("codepRelayAdminToken", tokenInput.value.trim());
      formMessage.textContent = "Admin token saved in this browser.";
      loadUsers();
      loadDevices();
    });

    document.querySelector("#createUser").addEventListener("click", async () => {
      formMessage.textContent = "";
      try {
        const body = await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            name: document.querySelector("#userName").value,
            api_key: document.querySelector("#apiKey").value
          })
        });
        formMessage.innerHTML = 'Created key: <code>' + escapeHTML(body.user.api_key) + '</code>';
        document.querySelector("#apiKey").value = "";
        loadUsers();
      } catch (error) {
        formMessage.innerHTML = '<span class="error">' + escapeHTML(error.message) + '</span>';
      }
    });

    document.querySelector("#users").addEventListener("click", async event => {
      const id = event.target.getAttribute("data-revoke");
      if (!id) return;
      await api("/api/users/" + encodeURIComponent(id), { method: "DELETE" });
      loadUsers();
    });

    document.querySelector("#refreshUsers").addEventListener("click", loadUsers);
    document.querySelector("#refreshDevices").addEventListener("click", loadDevices);
    loadUsers();
    loadDevices();
  </script>
</body>
</html>`))
