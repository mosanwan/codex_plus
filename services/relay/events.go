package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const maxBacklogEvents = 200

type eventStore struct {
	db *sql.DB
}

type relayEventRecord struct {
	ID            int64           `json:"id"`
	UserID        string          `json:"user_id"`
	DeviceID      string          `json:"device_id"`
	SourceEventID string          `json:"source_event_id"`
	Type          string          `json:"type"`
	WorkspaceID   string          `json:"workspace_id,omitempty"`
	SessionID     string          `json:"session_id,omitempty"`
	Title         string          `json:"title,omitempty"`
	Body          string          `json:"body,omitempty"`
	Payload       json.RawMessage `json:"payload,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
}

type eventPublishRequest struct {
	SourceEventID string          `json:"source_event_id"`
	Type          string          `json:"type"`
	WorkspaceID   string          `json:"workspace_id"`
	SessionID     string          `json:"session_id"`
	Title         string          `json:"title"`
	Body          string          `json:"body"`
	Payload       json.RawMessage `json:"payload"`
}

func newEventStore(path string) (*eventStore, error) {
	if strings.TrimSpace(path) == "" {
		path = ".codep-relay.db"
	}

	dir := filepath.Dir(path)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, err
		}
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)

	store := &eventStore{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *eventStore) close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *eventStore) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(user_id, device_id, source_event_id)
);
CREATE INDEX IF NOT EXISTS events_user_device_id_idx ON events(user_id, device_id, id);
CREATE INDEX IF NOT EXISTS events_session_idx ON events(user_id, device_id, session_id, id);

CREATE TABLE IF NOT EXISTS event_cursors (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  client_device_id TEXT NOT NULL,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, device_id, client_device_id)
);
`)
	return err
}

func (s *eventStore) publish(
	userID string,
	deviceID string,
	request eventPublishRequest,
) (relayEventRecord, error) {
	request.SourceEventID = strings.TrimSpace(request.SourceEventID)
	request.Type = strings.TrimSpace(request.Type)
	if request.SourceEventID == "" {
		return relayEventRecord{}, errors.New("source_event_id is required")
	}
	if request.Type == "" {
		return relayEventRecord{}, errors.New("event type is required")
	}
	if len(request.Payload) == 0 {
		request.Payload = json.RawMessage(`{}`)
	}

	now := time.Now().UTC()
	_, err := s.db.Exec(
		`INSERT OR IGNORE INTO events
		  (user_id, device_id, source_event_id, type, workspace_id, session_id, title, body, payload_json, created_at)
		  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID,
		deviceID,
		request.SourceEventID,
		request.Type,
		request.WorkspaceID,
		request.SessionID,
		request.Title,
		request.Body,
		string(request.Payload),
		now.Format(time.RFC3339Nano),
	)
	if err != nil {
		return relayEventRecord{}, err
	}
	return s.eventBySource(userID, deviceID, request.SourceEventID)
}

func (s *eventStore) eventBySource(
	userID string,
	deviceID string,
	sourceEventID string,
) (relayEventRecord, error) {
	row := s.db.QueryRow(
		`SELECT id, user_id, device_id, source_event_id, type, workspace_id, session_id, title, body, payload_json, created_at
		   FROM events
		  WHERE user_id = ? AND device_id = ? AND source_event_id = ?`,
		userID,
		deviceID,
		sourceEventID,
	)
	return scanRelayEvent(row)
}

func (s *eventStore) listAfter(
	userID string,
	deviceID string,
	afterID int64,
	limit int,
) ([]relayEventRecord, error) {
	if limit <= 0 || limit > maxBacklogEvents {
		limit = maxBacklogEvents
	}

	rows, err := s.db.Query(
		`SELECT id, user_id, device_id, source_event_id, type, workspace_id, session_id, title, body, payload_json, created_at
		   FROM events
		  WHERE user_id = ? AND device_id = ? AND id > ?
		  ORDER BY id ASC
		  LIMIT ?`,
		userID,
		deviceID,
		afterID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []relayEventRecord{}
	for rows.Next() {
		event, err := scanRelayEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *eventStore) cursor(userID string, deviceID string, clientDeviceID string) (int64, error) {
	var lastEventID int64
	err := s.db.QueryRow(
		`SELECT last_event_id
		   FROM event_cursors
		  WHERE user_id = ? AND device_id = ? AND client_device_id = ?`,
		userID,
		deviceID,
		clientDeviceID,
	).Scan(&lastEventID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return lastEventID, err
}

func (s *eventStore) ack(
	userID string,
	deviceID string,
	clientDeviceID string,
	lastEventID int64,
) error {
	if lastEventID < 0 {
		lastEventID = 0
	}
	_, err := s.db.Exec(
		`INSERT INTO event_cursors (user_id, device_id, client_device_id, last_event_id, updated_at)
		  VALUES (?, ?, ?, ?, ?)
		  ON CONFLICT(user_id, device_id, client_device_id) DO UPDATE SET
		    last_event_id = MAX(event_cursors.last_event_id, excluded.last_event_id),
		    updated_at = excluded.updated_at`,
		userID,
		deviceID,
		clientDeviceID,
		lastEventID,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	return err
}

type relayEventScanner interface {
	Scan(dest ...any) error
}

func scanRelayEvent(row relayEventScanner) (relayEventRecord, error) {
	var event relayEventRecord
	var payload string
	var createdAt string
	if err := row.Scan(
		&event.ID,
		&event.UserID,
		&event.DeviceID,
		&event.SourceEventID,
		&event.Type,
		&event.WorkspaceID,
		&event.SessionID,
		&event.Title,
		&event.Body,
		&payload,
		&createdAt,
	); err != nil {
		return relayEventRecord{}, err
	}
	event.Payload = json.RawMessage(payload)
	parsedAt, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return relayEventRecord{}, err
	}
	event.CreatedAt = parsedAt
	return event, nil
}
