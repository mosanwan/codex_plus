package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const adminSessionCookie = "codep_relay_admin"
const relaySessionCookie = "codep_relay_session"

type relaySession struct {
	Role      string `json:"role"`
	UserID    string `json:"user_id"`
	UserName  string `json:"user_name"`
	ExpiresAt int64  `json:"expires_at"`
}

func (s *server) setAdminSession(w http.ResponseWriter) {
	expires := time.Now().Add(24 * time.Hour)
	subject := s.cfg.adminUsername
	payload := subject + "|" + strconv.FormatInt(expires.Unix(), 10)
	signature := signString(s.cfg.hashSecret(), payload)
	cookieValue := base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + signature))
	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookie,
		Value:    cookieValue,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *server) setRelaySession(w http.ResponseWriter, role string, userID string, userName string) {
	expires := time.Now().Add(24 * time.Hour)
	session := relaySession{
		Role:      role,
		UserID:    userID,
		UserName:  userName,
		ExpiresAt: expires.Unix(),
	}
	payload, err := json.Marshal(session)
	if err != nil {
		panic(err)
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signature := signString(s.cfg.hashSecret(), encodedPayload)
	http.SetCookie(w, &http.Cookie{
		Name:     relaySessionCookie,
		Value:    encodedPayload + "." + signature,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearAdminSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookie,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearRelaySession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     relaySessionCookie,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *server) validAdminSession(r *http.Request) bool {
	cookie, err := r.Cookie(adminSessionCookie)
	if err != nil || cookie.Value == "" {
		return false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(cookie.Value)
	if err != nil {
		return false
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 3 {
		return false
	}
	if parts[0] != s.cfg.adminUsername {
		return false
	}
	expiresUnix, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || time.Now().Unix() > expiresUnix {
		return false
	}
	expected := signString(s.cfg.hashSecret(), parts[0]+"|"+parts[1])
	return hmac.Equal([]byte(expected), []byte(parts[2]))
}

func (s *server) currentRelaySession(r *http.Request) (relaySession, bool) {
	cookie, err := r.Cookie(relaySessionCookie)
	if err != nil || cookie.Value == "" {
		return relaySession{}, false
	}
	parts := strings.Split(cookie.Value, ".")
	if len(parts) != 2 {
		return relaySession{}, false
	}
	expected := signString(s.cfg.hashSecret(), parts[0])
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return relaySession{}, false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return relaySession{}, false
	}
	var session relaySession
	if err := json.Unmarshal(decoded, &session); err != nil {
		return relaySession{}, false
	}
	if session.UserID == "" || session.UserName == "" {
		return relaySession{}, false
	}
	if session.Role != "admin" && session.Role != "user" {
		return relaySession{}, false
	}
	if time.Now().Unix() > session.ExpiresAt {
		return relaySession{}, false
	}
	return session, true
}

func signString(secret string, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}
