package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestRelayRequiresAPIKeyAndForwardsWithinUserRoom(t *testing.T) {
	t.Parallel()

	store, err := newUserStore(t.TempDir()+"/relay.db", t.TempDir()+"/relay.json", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.create("three", "cp_test")
	if err != nil {
		t.Fatal(err)
	}
	events, err := newEventStore(t.TempDir() + "/relay.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = events.close() })

	srv := newServer(config{}, store, events, slog.New(slog.NewTextHandler(io.Discard, nil)))
	httpServer := httptest.NewServer(srv.routes())
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")

	_, response, err := websocket.DefaultDialer.Dial(wsURL+"/ws/client?device_id=desktop-main", nil)
	if err == nil {
		t.Fatal("expected websocket dial without api key to fail")
	}
	if response == nil || response.StatusCode != 401 {
		t.Fatalf("expected 401 without api key, got response=%v err=%v", response, err)
	}

	desktop := dialRelay(t, wsURL+"/ws/desktop?device_id=desktop-main&api_key=cp_test")
	t.Cleanup(func() { _ = desktop.Close() })
	client := dialRelay(t, wsURL+"/ws/client?device_id=desktop-main&api_key=cp_test")
	t.Cleanup(func() { _ = client.Close() })

	readEnvelope(t, desktop, "relay.connected")
	readEnvelope(t, desktop, "relay.presence")
	readEnvelope(t, client, "relay.connected")
	presence := readEnvelope(t, client, "relay.presence")
	presencePayload, ok := presence["payload"].(map[string]any)
	if !ok {
		t.Fatalf("expected presence payload, got %#v", presence["payload"])
	}
	if presencePayload["desktop_count"] != float64(1) || presencePayload["client_count"] != float64(1) {
		t.Fatalf("expected one desktop and one client, got %#v", presencePayload)
	}

	if err := client.WriteJSON(map[string]any{
		"type": "turn.start",
		"payload": map[string]any{
			"text": "hello",
		},
	}); err != nil {
		t.Fatal(err)
	}

	received := readEnvelope(t, desktop, "turn.start")
	if received["from"] != "client" {
		t.Fatalf("expected client sender, got %v", received["from"])
	}
	if received["user_id"] != user.ID {
		t.Fatalf("expected user id %s, got %v", user.ID, received["user_id"])
	}
	if received["device_id"] != "desktop-main" {
		t.Fatalf("expected device id desktop-main, got %v", received["device_id"])
	}
}

func TestAdminLoginInviteAndRegister(t *testing.T) {
	t.Parallel()

	store, err := newUserStore(t.TempDir()+"/relay.db", t.TempDir()+"/relay.json", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	events, err := newEventStore(t.TempDir() + "/events.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.close() })
	t.Cleanup(func() { _ = events.close() })

	srv := newServer(config{
		adminUsername: "admin",
		adminPassword: "secret",
		sessionSecret: "session-secret",
	}, store, events, slog.New(slog.NewTextHandler(io.Discard, nil)))
	httpServer := httptest.NewServer(srv.routes())
	t.Cleanup(httpServer.Close)

	response, body := postJSON(t, httpServer.URL+"/api/admin/login", map[string]any{
		"username": "admin",
		"password": "secret",
	}, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected admin login 200, got %d body=%s", response.StatusCode, body)
	}
	cookies := response.Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected admin session cookie")
	}

	response, body = postJSON(t, httpServer.URL+"/api/invites", map[string]any{
		"max_uses": 1,
	}, cookies)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("expected create invite 201, got %d body=%s", response.StatusCode, body)
	}
	var inviteBody map[string]any
	if err := json.Unmarshal([]byte(body), &inviteBody); err != nil {
		t.Fatal(err)
	}
	code, ok := inviteBody["code"].(string)
	if !ok || code == "" {
		t.Fatalf("expected invite code, got %#v", inviteBody)
	}

	response, body = postJSON(t, httpServer.URL+"/api/auth/register", map[string]any{
		"username":    "mobile-user",
		"password":    "pw",
		"invite_code": code,
	}, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("expected register 201, got %d body=%s", response.StatusCode, body)
	}
	var registerBody map[string]any
	if err := json.Unmarshal([]byte(body), &registerBody); err != nil {
		t.Fatal(err)
	}
	apiKey, ok := registerBody["api_key"].(string)
	if !ok || !strings.HasPrefix(apiKey, "cp_") {
		t.Fatalf("expected api key, got %#v", registerBody["api_key"])
	}
	if _, ok := store.authenticate(apiKey); !ok {
		t.Fatal("expected registered api key to authenticate")
	}

	response, body = postJSON(t, httpServer.URL+"/api/auth/login", map[string]any{
		"username": "mobile-user",
		"password": "pw",
	}, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected user login 200, got %d body=%s", response.StatusCode, body)
	}
	var loginBody map[string]any
	if err := json.Unmarshal([]byte(body), &loginBody); err != nil {
		t.Fatal(err)
	}
	session, ok := loginBody["session"].(map[string]any)
	if !ok || session["role"] != "user" {
		t.Fatalf("expected user session, got %#v", loginBody["session"])
	}

	response, body = postJSON(t, httpServer.URL+"/api/auth/api-keys", map[string]any{
		"name": "phone",
	}, response.Cookies())
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("expected create current user api key 201, got %d body=%s", response.StatusCode, body)
	}
	var keyBody map[string]any
	if err := json.Unmarshal([]byte(body), &keyBody); err != nil {
		t.Fatal(err)
	}
	nextAPIKey, ok := keyBody["api_key"].(string)
	if !ok || !strings.HasPrefix(nextAPIKey, "cp_") {
		t.Fatalf("expected current user api key, got %#v", keyBody["api_key"])
	}
}

func TestCurrentDevicesAcceptsAPIKey(t *testing.T) {
	t.Parallel()

	store, err := newUserStore(t.TempDir()+"/relay.db", t.TempDir()+"/relay.json", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.create("three", "cp_test_devices")
	if err != nil {
		t.Fatal(err)
	}
	events, err := newEventStore(t.TempDir() + "/events.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.close() })
	t.Cleanup(func() { _ = events.close() })

	srv := newServer(config{}, store, events, slog.New(slog.NewTextHandler(io.Discard, nil)))
	httpServer := httptest.NewServer(srv.routes())
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	desktop := dialRelay(t, wsURL+"/ws/desktop?device_id=desktop-main&api_key=cp_test_devices")
	t.Cleanup(func() { _ = desktop.Close() })
	readEnvelope(t, desktop, "relay.connected")

	request, err := http.NewRequest(http.MethodGet, httpServer.URL+"/api/auth/devices", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-CodeP-Api-Key", "cp_test_devices")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected devices 200, got %d body=%s", response.StatusCode, body)
	}

	var devicesBody map[string][]deviceSummary
	if err := json.Unmarshal(body, &devicesBody); err != nil {
		t.Fatal(err)
	}
	devices := devicesBody["devices"]
	if len(devices) != 1 {
		t.Fatalf("expected one device for user %s, got %#v", user.ID, devices)
	}
	if devices[0].DeviceID != "desktop-main" || devices[0].DesktopCount != 1 {
		t.Fatalf("expected online desktop-main, got %#v", devices[0])
	}
}

func TestRelayReplaysLatestDesktopSnapshotToNewClient(t *testing.T) {
	t.Parallel()

	store, err := newUserStore(t.TempDir()+"/relay.db", t.TempDir()+"/relay.json", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.create("three", "cp_test_snapshot")
	if err != nil {
		t.Fatal(err)
	}
	events, err := newEventStore(t.TempDir() + "/relay.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = events.close() })

	srv := newServer(config{}, store, events, slog.New(slog.NewTextHandler(io.Discard, nil)))
	httpServer := httptest.NewServer(srv.routes())
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	desktop := dialRelay(t, wsURL+"/ws/desktop?device_id=desktop-main&api_key=cp_test_snapshot")
	t.Cleanup(func() { _ = desktop.Close() })
	readEnvelope(t, desktop, "relay.connected")

	if err := desktop.WriteJSON(map[string]any{
		"type": "desktop.snapshot",
		"payload": map[string]any{
			"workspaces": []map[string]any{
				{
					"path": "/workspace/codep",
					"name": "codep",
				},
			},
		},
	}); err != nil {
		t.Fatal(err)
	}

	client := dialRelay(t, wsURL+"/ws/client?device_id=desktop-main&api_key=cp_test_snapshot")
	t.Cleanup(func() { _ = client.Close() })
	readEnvelope(t, client, "relay.connected")
	replayed := readEnvelope(t, client, "desktop.snapshot")

	if replayed["from"] != "desktop" {
		t.Fatalf("expected desktop sender, got %v", replayed["from"])
	}
	if replayed["user_id"] != user.ID {
		t.Fatalf("expected user id %s, got %v", user.ID, replayed["user_id"])
	}

	payload, ok := replayed["payload"].(map[string]any)
	if !ok {
		t.Fatalf("expected payload object, got %T", replayed["payload"])
	}
	workspaces, ok := payload["workspaces"].([]any)
	if !ok || len(workspaces) != 1 {
		t.Fatalf("expected one workspace in replayed snapshot, got %#v", payload["workspaces"])
	}
}

func TestRelayPersistsAndReplaysEventsAfterMobileReconnect(t *testing.T) {
	t.Parallel()

	store, err := newUserStore(t.TempDir()+"/relay.db", t.TempDir()+"/relay.json", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.create("three", "cp_test_events")
	if err != nil {
		t.Fatal(err)
	}
	events, err := newEventStore(t.TempDir() + "/relay.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = events.close() })

	srv := newServer(config{}, store, events, slog.New(slog.NewTextHandler(io.Discard, nil)))
	httpServer := httptest.NewServer(srv.routes())
	t.Cleanup(httpServer.Close)

	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http")
	desktop := dialRelay(t, wsURL+"/ws/desktop?device_id=desktop-main&api_key=cp_test_events")
	t.Cleanup(func() { _ = desktop.Close() })
	readEnvelope(t, desktop, "relay.connected")

	if err := desktop.WriteJSON(map[string]any{
		"type": "event.publish",
		"payload": map[string]any{
			"source_event_id": "desktop-main:thread-1:turn-1:completed",
			"type":            "turn.completed",
			"workspace_id":    "/workspace/codep",
			"session_id":      "thread-1",
			"title":           "Turn completed",
			"body":            "Codex finished.",
		},
	}); err != nil {
		t.Fatal(err)
	}

	published := readEnvelope(t, desktop, "event.published")
	publishedPayload, ok := published["payload"].(map[string]any)
	if !ok {
		t.Fatalf("expected event.published payload, got %#v", published["payload"])
	}
	publishedEvent, ok := publishedPayload["event"].(map[string]any)
	if !ok {
		t.Fatalf("expected published event, got %#v", publishedPayload["event"])
	}
	if publishedEvent["type"] != "turn.completed" {
		t.Fatalf("expected turn.completed, got %#v", publishedEvent["type"])
	}

	client := dialRelay(t, wsURL+"/ws/client?device_id=desktop-main&client_device_id=mobile-one&api_key=cp_test_events")
	t.Cleanup(func() { _ = client.Close() })
	readEnvelope(t, client, "relay.connected")
	if err := client.WriteJSON(map[string]any{
		"type": "client.resume_events",
		"payload": map[string]any{
			"last_event_id": 0,
		},
	}); err != nil {
		t.Fatal(err)
	}

	backlog := readEnvelope(t, client, "event.backlog")
	backlogPayload, ok := backlog["payload"].(map[string]any)
	if !ok {
		t.Fatalf("expected backlog payload, got %#v", backlog["payload"])
	}
	backlogEvents, ok := backlogPayload["events"].([]any)
	if !ok || len(backlogEvents) != 1 {
		t.Fatalf("expected one backlog event, got %#v", backlogPayload["events"])
	}
	firstEvent, ok := backlogEvents[0].(map[string]any)
	if !ok {
		t.Fatalf("expected backlog event object, got %#v", backlogEvents[0])
	}
	firstEventID, ok := firstEvent["id"].(float64)
	if !ok {
		t.Fatalf("expected backlog event id, got %#v", firstEvent["id"])
	}
	if err := client.WriteJSON(map[string]any{
		"type": "event.ack",
		"payload": map[string]any{
			"last_event_id": int64(firstEventID),
		},
	}); err != nil {
		t.Fatal(err)
	}
	_ = client.Close()

	reconnected := dialRelay(t, wsURL+"/ws/client?device_id=desktop-main&client_device_id=mobile-one&api_key=cp_test_events")
	t.Cleanup(func() { _ = reconnected.Close() })
	readEnvelope(t, reconnected, "relay.connected")
	if err := reconnected.WriteJSON(map[string]any{
		"type": "client.resume_events",
		"payload": map[string]any{
			"last_event_id": int64(firstEventID),
		},
	}); err != nil {
		t.Fatal(err)
	}
	emptyBacklog := readEnvelope(t, reconnected, "event.backlog")
	emptyPayload, ok := emptyBacklog["payload"].(map[string]any)
	if !ok {
		t.Fatalf("expected empty backlog payload, got %#v", emptyBacklog["payload"])
	}
	emptyEvents, ok := emptyPayload["events"].([]any)
	if !ok || len(emptyEvents) != 0 {
		t.Fatalf("expected empty backlog after ack, got %#v", emptyPayload["events"])
	}
}

func dialRelay(t *testing.T, url string) *websocket.Conn {
	t.Helper()

	conn, response, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		t.Fatalf("dial failed status=%d err=%v", status, err)
	}
	return conn
}

func postJSON(
	t *testing.T,
	url string,
	body map[string]any,
	cookies []*http.Cookie,
) (*http.Response, string) {
	t.Helper()

	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	content, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response, string(content)
}

func readEnvelope(t *testing.T, conn *websocket.Conn, expectedType string) map[string]any {
	t.Helper()

	for i := 0; i < 10; i++ {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		var envelope map[string]any
		if err := json.Unmarshal(payload, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope["type"] == expectedType {
			return envelope
		}
		if expectedType != "relay.presence" && envelope["type"] == "relay.presence" {
			continue
		}
		t.Fatalf("expected %s, got %v payload=%s", expectedType, envelope["type"], string(payload))
	}
	t.Fatalf("expected %s, got only relay.presence messages", expectedType)
	return nil
}
