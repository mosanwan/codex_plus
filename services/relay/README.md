# Codex+ Relay

Development relay for connecting a Codex+ desktop app to mobile clients.

The relay has a small admin UI for managing users, invites, and per-user API keys:

- Open `http://127.0.0.1:8909/`.
- Sign in with the admin username/password configured in `.env`.
- Create an invite code, or create one user API key directly for local testing.
- Configure the same API key in the desktop app and mobile app.
- Desktop connects to `/ws/desktop?device_id=<id>` with the API key.
- Mobile/browser connects to `/ws/client?device_id=<desktop-id>&client_device_id=<mobile-id>` with the same API key.
- Text or binary WebSocket messages are forwarded to the opposite side in the
  same user/device room.
- Desktop can publish durable relay events with `event.publish`. Events are
  stored in SQLite, delivered to online mobile clients, and replayed after
  reconnect from the mobile client's acknowledged cursor.
- Different users are isolated by API key.

Run locally:

```bash
cd services/relay
go run . -addr 0.0.0.0:8909
```

Optional environment variables:

```bash
CODEP_RELAY_ADDR=0.0.0.0:8909
CODEP_RELAY_DATA=.codep-relay.json
CODEP_RELAY_DB=.codep-relay.db
CODEP_RELAY_ADMIN_USERNAME=admin
CODEP_RELAY_ADMIN_PASSWORD=change-me
CODEP_RELAY_SESSION_SECRET=change-this-long-random-secret
```

Protect the admin UI/API before exposing the server:

```bash
cd services/relay
cp .env.example .env
$EDITOR .env
go run .
```

The server still accepts `CODEP_RELAY_ADMIN_TOKEN` for script compatibility, but
the browser UI uses an httpOnly admin session cookie after login.

Health and discovery:

```bash
curl http://127.0.0.1:8909/healthz
curl -H 'X-CodeP-Admin-Token: change-me' http://127.0.0.1:8909/api/devices
```

For LAN testing, use the workstation IP from the phone browser, for example:

```text
http://192.168.1.20:8909/healthz
```

## Production Deployment

Current production target:

- SSH alias: `prod`
- Public endpoint: `https://codex-bridge.three.ink`
- App binary: `/opt/codep-relay/codep-relay`
- Service unit: `/etc/systemd/system/codep-relay.service`
- Environment file: `/etc/codep-relay/relay.env`
- Persistent data: `/var/lib/codep-relay/relay.db`
- Local listen address on server: `127.0.0.1:8909`
- nginx proxies `https://codex-bridge.three.ink/` to `http://127.0.0.1:8909`

Deploy the current relay code:

```bash
npm run deploy:relay:prod
```

The deploy script:

1. Runs `go test ./...` in `services/relay`.
2. Builds a Linux amd64 static binary with `CGO_ENABLED=0`.
3. Uploads it to `prod:/tmp/codep-relay.new`.
4. Installs it to `/opt/codep-relay/codep-relay`.
5. Backs up the previous binary with a timestamp suffix.
6. Restarts `codep-relay` via systemd.
7. Verifies both local and public health checks.

Manual verification:

```bash
ssh prod 'systemctl status codep-relay --no-pager -l'
ssh prod 'journalctl -u codep-relay --since "10 minutes ago" --no-pager'
curl https://codex-bridge.three.ink/healthz
```

Do not commit values from `/etc/codep-relay/relay.env`; it contains production
admin and session secrets. Desktop and mobile clients should use the same API
key and this relay endpoint:

```text
wss://codex-bridge.three.ink
```
