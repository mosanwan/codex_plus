package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"
)

type userStore struct {
	db     *sql.DB
	secret string
}

type userFile struct {
	Users []userRecord `json:"users"`
}

type inviteRecord struct {
	ID        string     `json:"id"`
	Code      string     `json:"code,omitempty"`
	CodeHint  string     `json:"code_hint"`
	MaxUses   int        `json:"max_uses"`
	UsedCount int        `json:"used_count"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

type apiKeyRecord struct {
	ID         string     `json:"id"`
	KeyPrefix  string     `json:"key_prefix"`
	Name       string     `json:"name"`
	CreatedAt  time.Time  `json:"created_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

func newUserStore(dbPath string, legacyPath string, secret string) (*userStore, error) {
	events, err := newEventStore(dbPath)
	if err != nil {
		return nil, err
	}
	store := &userStore{
		db:     events.db,
		secret: secret,
	}
	events.db = nil
	if err := store.migrate(); err != nil {
		_ = store.close()
		return nil, err
	}
	if err := store.importLegacyUsers(legacyPath); err != nil {
		_ = store.close()
		return nil, err
	}
	return store, nil
}

func (s *userStore) close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *userStore) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_redemptions (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES invites(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  redeemed_at TEXT NOT NULL
);
`)
	return err
}

func (s *userStore) importLegacyUsers(path string) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	content, err := os.ReadFile(path)
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
		if user.RevokedAt != nil {
			continue
		}
		apiKey := strings.TrimSpace(user.APIKey)
		if apiKey == "" {
			continue
		}
		if _, err := s.create(user.Name, apiKey); err != nil {
			return err
		}
	}
	return nil
}

func (s *userStore) list() []userRecord {
	rows, err := s.db.Query(`
SELECT u.id, u.name, COALESCE(k.key_prefix, ''), u.created_at, u.revoked_at
  FROM users u
  LEFT JOIN api_keys k ON k.id = (
    SELECT id
      FROM api_keys
     WHERE user_id = u.id AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1
  )
 ORDER BY u.created_at DESC`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	users := []userRecord{}
	for rows.Next() {
		user, err := scanUser(rows)
		if err == nil {
			users = append(users, user)
		}
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

	now := time.Now().UTC()
	user := userRecord{
		ID:           "usr_" + randomHex(10),
		Name:         name,
		APIKey:       apiKey,
		APIKeyPrefix: keyPrefix(apiKey),
		CreatedAt:    now,
	}

	tx, err := s.db.Begin()
	if err != nil {
		return userRecord{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)`,
		user.ID,
		user.Name,
		now.Format(time.RFC3339Nano),
	); err != nil {
		return userRecord{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)`,
		"key_"+randomHex(10),
		user.ID,
		s.hashSecret(apiKey),
		user.APIKeyPrefix,
		now.Format(time.RFC3339Nano),
	); err != nil {
		return userRecord{}, err
	}
	return user, tx.Commit()
}

func (s *userStore) register(name string, password string, inviteCode string) (userRecord, string, error) {
	name = strings.TrimSpace(name)
	password = strings.TrimSpace(password)
	inviteCode = strings.TrimSpace(inviteCode)
	if name == "" {
		return userRecord{}, "", errors.New("username is required")
	}
	if password == "" {
		return userRecord{}, "", errors.New("password is required")
	}
	if inviteCode == "" {
		return userRecord{}, "", errors.New("invite code is required")
	}

	invite, err := s.inviteByCode(inviteCode)
	if err != nil {
		return userRecord{}, "", errors.New("invalid invite code")
	}
	if invite.RevokedAt != nil {
		return userRecord{}, "", errors.New("invite has been revoked")
	}
	if invite.ExpiresAt != nil && time.Now().After(*invite.ExpiresAt) {
		return userRecord{}, "", errors.New("invite has expired")
	}
	if invite.MaxUses > 0 && invite.UsedCount >= invite.MaxUses {
		return userRecord{}, "", errors.New("invite has already been used")
	}

	apiKey := "cp_" + randomHex(24)
	now := time.Now().UTC()
	user := userRecord{
		ID:           "usr_" + randomHex(10),
		Name:         name,
		APIKey:       apiKey,
		APIKeyPrefix: keyPrefix(apiKey),
		CreatedAt:    now,
	}

	tx, err := s.db.Begin()
	if err != nil {
		return userRecord{}, "", err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`INSERT INTO users (id, name, password_hash, created_at) VALUES (?, ?, ?, ?)`,
		user.ID,
		user.Name,
		passwordHash(s.secret, password),
		now.Format(time.RFC3339Nano),
	); err != nil {
		return userRecord{}, "", err
	}
	if _, err := tx.Exec(
		`INSERT INTO api_keys (id, user_id, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)`,
		"key_"+randomHex(10),
		user.ID,
		s.hashSecret(apiKey),
		user.APIKeyPrefix,
		now.Format(time.RFC3339Nano),
	); err != nil {
		return userRecord{}, "", err
	}
	if _, err := tx.Exec(
		`UPDATE invites SET used_count = used_count + 1 WHERE id = ?`,
		invite.ID,
	); err != nil {
		return userRecord{}, "", err
	}
	if _, err := tx.Exec(
		`INSERT INTO invite_redemptions (id, invite_id, user_id, redeemed_at) VALUES (?, ?, ?, ?)`,
		"red_"+randomHex(10),
		invite.ID,
		user.ID,
		now.Format(time.RFC3339Nano),
	); err != nil {
		return userRecord{}, "", err
	}
	return user, apiKey, tx.Commit()
}

func (s *userStore) login(name string, password string) (userRecord, error) {
	name = strings.TrimSpace(name)
	password = strings.TrimSpace(password)
	if name == "" || password == "" {
		return userRecord{}, errors.New("username and password are required")
	}

	var passwordHashValue string
	row := s.db.QueryRow(`
SELECT id, name, '', created_at, revoked_at, password_hash
  FROM users
 WHERE name = ? AND revoked_at IS NULL`,
		name,
	)
	var user userRecord
	var createdAt string
	var revokedAt sql.NullString
	if err := row.Scan(&user.ID, &user.Name, &user.APIKeyPrefix, &createdAt, &revokedAt, &passwordHashValue); err != nil {
		return userRecord{}, errors.New("invalid credentials")
	}
	if passwordHashValue == "" || !hmac.Equal([]byte(passwordHashValue), []byte(passwordHash(s.secret, password))) {
		return userRecord{}, errors.New("invalid credentials")
	}
	parsedCreatedAt, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return userRecord{}, err
	}
	user.CreatedAt = parsedCreatedAt
	return user, nil
}

func (s *userStore) byID(id string) (userRecord, error) {
	row := s.db.QueryRow(`
SELECT u.id, u.name, COALESCE(k.key_prefix, ''), u.created_at, u.revoked_at
  FROM users u
  LEFT JOIN api_keys k ON k.user_id = u.id AND k.revoked_at IS NULL
 WHERE u.id = ? AND u.revoked_at IS NULL
 ORDER BY k.created_at DESC
 LIMIT 1`,
		strings.TrimSpace(id),
	)
	return scanUser(row)
}

func (s *userStore) listAPIKeys(userID string) []apiKeyRecord {
	rows, err := s.db.Query(`
SELECT id, key_prefix, name, created_at, revoked_at, last_used_at
  FROM api_keys
 WHERE user_id = ?
 ORDER BY created_at DESC`,
		strings.TrimSpace(userID),
	)
	if err != nil {
		return nil
	}
	defer rows.Close()

	keys := []apiKeyRecord{}
	for rows.Next() {
		key, err := scanAPIKey(rows)
		if err == nil {
			keys = append(keys, key)
		}
	}
	return keys
}

func (s *userStore) createAPIKey(userID string, name string) (apiKeyRecord, string, error) {
	userID = strings.TrimSpace(userID)
	name = strings.TrimSpace(name)
	if name == "" {
		name = "default"
	}
	if _, err := s.byID(userID); err != nil {
		return apiKeyRecord{}, "", errors.New("user not found")
	}
	apiKey := "cp_" + randomHex(24)
	now := time.Now().UTC()
	key := apiKeyRecord{
		ID:        "key_" + randomHex(10),
		KeyPrefix: keyPrefix(apiKey),
		Name:      name,
		CreatedAt: now,
	}
	_, err := s.db.Exec(
		`INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		key.ID,
		userID,
		s.hashSecret(apiKey),
		key.KeyPrefix,
		key.Name,
		now.Format(time.RFC3339Nano),
	)
	return key, apiKey, err
}

func (s *userStore) revoke(id string) error {
	result, err := s.db.Exec(
		`UPDATE users SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
		time.Now().UTC().Format(time.RFC3339Nano),
		id,
	)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return errors.New("user not found")
	}
	_, _ = s.db.Exec(
		`UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
		time.Now().UTC().Format(time.RFC3339Nano),
		id,
	)
	return nil
}

func (s *userStore) authenticate(apiKey string) (userRecord, bool) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return userRecord{}, false
	}

	row := s.db.QueryRow(`
SELECT u.id, u.name, k.key_prefix, u.created_at, u.revoked_at
  FROM api_keys k
  JOIN users u ON u.id = k.user_id
 WHERE k.key_hash = ? AND k.revoked_at IS NULL AND u.revoked_at IS NULL`,
		s.hashSecret(apiKey),
	)
	user, err := scanUser(row)
	if err != nil {
		return userRecord{}, false
	}
	_, _ = s.db.Exec(
		`UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?`,
		time.Now().UTC().Format(time.RFC3339Nano),
		s.hashSecret(apiKey),
	)
	return user, true
}

func (s *userStore) listInvites() []inviteRecord {
	rows, err := s.db.Query(`
SELECT id, code_hint, max_uses, used_count, expires_at, revoked_at, created_at
  FROM invites
 ORDER BY created_at DESC`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	invites := []inviteRecord{}
	for rows.Next() {
		invite, err := scanInvite(rows)
		if err == nil {
			invites = append(invites, invite)
		}
	}
	return invites
}

func (s *userStore) createInvite(createdBy string, maxUses int, expiresAtValue string) (inviteRecord, string, error) {
	if maxUses <= 0 {
		maxUses = 1
	}

	var expiresAt *time.Time
	if strings.TrimSpace(expiresAtValue) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(expiresAtValue))
		if err != nil {
			return inviteRecord{}, "", errors.New("expires_at must be RFC3339")
		}
		expiresAt = &parsed
	}

	code := "cp_inv_" + randomHex(16)
	now := time.Now().UTC()
	invite := inviteRecord{
		ID:        "inv_" + randomHex(10),
		Code:      code,
		CodeHint:  keyPrefix(code),
		MaxUses:   maxUses,
		UsedCount: 0,
		ExpiresAt: expiresAt,
		CreatedAt: now,
	}
	var expiresText any
	if expiresAt != nil {
		expiresText = expiresAt.UTC().Format(time.RFC3339Nano)
	}
	_, err := s.db.Exec(
		`INSERT INTO invites (id, code_hash, code_hint, created_by, max_uses, expires_at, created_at)
		  VALUES (?, ?, ?, ?, ?, ?, ?)`,
		invite.ID,
		s.hashSecret(code),
		invite.CodeHint,
		createdBy,
		invite.MaxUses,
		expiresText,
		now.Format(time.RFC3339Nano),
	)
	return invite, code, err
}

func (s *userStore) revokeInvite(id string) error {
	result, err := s.db.Exec(
		`UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
		time.Now().UTC().Format(time.RFC3339Nano),
		id,
	)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return errors.New("invite not found")
	}
	return nil
}

func (s *userStore) inviteByCode(code string) (inviteRecord, error) {
	row := s.db.QueryRow(`
SELECT id, code_hint, max_uses, used_count, expires_at, revoked_at, created_at
  FROM invites
 WHERE code_hash = ?`,
		s.hashSecret(code),
	)
	return scanInvite(row)
}

func (s *userStore) hashSecret(value string) string {
	mac := hmac.New(sha256.New, []byte(s.secret))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

func scanUser(row interface{ Scan(dest ...any) error }) (userRecord, error) {
	var user userRecord
	var createdAt string
	var revokedAt sql.NullString
	if err := row.Scan(&user.ID, &user.Name, &user.APIKeyPrefix, &createdAt, &revokedAt); err != nil {
		return userRecord{}, err
	}
	parsedCreatedAt, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return userRecord{}, err
	}
	user.CreatedAt = parsedCreatedAt
	if revokedAt.Valid {
		parsedRevokedAt, err := time.Parse(time.RFC3339Nano, revokedAt.String)
		if err != nil {
			return userRecord{}, err
		}
		user.RevokedAt = &parsedRevokedAt
	}
	return user, nil
}

func scanInvite(row interface{ Scan(dest ...any) error }) (inviteRecord, error) {
	var invite inviteRecord
	var expiresAt sql.NullString
	var revokedAt sql.NullString
	var createdAt string
	if err := row.Scan(
		&invite.ID,
		&invite.CodeHint,
		&invite.MaxUses,
		&invite.UsedCount,
		&expiresAt,
		&revokedAt,
		&createdAt,
	); err != nil {
		return inviteRecord{}, err
	}
	parsedCreatedAt, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return inviteRecord{}, err
	}
	invite.CreatedAt = parsedCreatedAt
	if expiresAt.Valid {
		parsed, err := time.Parse(time.RFC3339Nano, expiresAt.String)
		if err != nil {
			return inviteRecord{}, err
		}
		invite.ExpiresAt = &parsed
	}
	if revokedAt.Valid {
		parsed, err := time.Parse(time.RFC3339Nano, revokedAt.String)
		if err != nil {
			return inviteRecord{}, err
		}
		invite.RevokedAt = &parsed
	}
	return invite, nil
}

func scanAPIKey(row interface{ Scan(dest ...any) error }) (apiKeyRecord, error) {
	var key apiKeyRecord
	var createdAt string
	var revokedAt sql.NullString
	var lastUsedAt sql.NullString
	if err := row.Scan(
		&key.ID,
		&key.KeyPrefix,
		&key.Name,
		&createdAt,
		&revokedAt,
		&lastUsedAt,
	); err != nil {
		return apiKeyRecord{}, err
	}
	parsedCreatedAt, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return apiKeyRecord{}, err
	}
	key.CreatedAt = parsedCreatedAt
	if revokedAt.Valid {
		parsed, err := time.Parse(time.RFC3339Nano, revokedAt.String)
		if err != nil {
			return apiKeyRecord{}, err
		}
		key.RevokedAt = &parsed
	}
	if lastUsedAt.Valid {
		parsed, err := time.Parse(time.RFC3339Nano, lastUsedAt.String)
		if err != nil {
			return apiKeyRecord{}, err
		}
		key.LastUsedAt = &parsed
	}
	return key, nil
}

func keyPrefix(value string) string {
	if len(value) <= 10 {
		return value
	}
	return value[:6] + "..." + value[len(value)-4:]
}

func passwordHash(secret string, password string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(password))
	return "hmac-sha256:" + hex.EncodeToString(mac.Sum(nil))
}
