package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestRelayRequiresAPIKeyAndForwardsWithinUserRoom(t *testing.T) {
	t.Parallel()

	store, err := newUserStore(t.TempDir() + "/relay.json")
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.create("three", "cp_test")
	if err != nil {
		t.Fatal(err)
	}

	srv := newServer(config{}, store, slog.New(slog.NewTextHandler(io.Discard, nil)))
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
	readEnvelope(t, client, "relay.connected")

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

func readEnvelope(t *testing.T, conn *websocket.Conn, expectedType string) map[string]any {
	t.Helper()

	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope["type"] != expectedType {
		t.Fatalf("expected %s, got %v payload=%s", expectedType, envelope["type"], string(payload))
	}
	return envelope
}
