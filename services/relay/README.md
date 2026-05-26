# Codex+ Relay

Development relay for connecting a Codex+ desktop app to mobile clients.

The relay has a small admin UI for managing per-user API keys:

- Open `http://127.0.0.1:8909/`.
- Create one user API key.
- Configure the same API key in the desktop app and mobile app.
- Desktop connects to `/ws/desktop?device_id=<id>` with the API key.
- Mobile/browser connects to `/ws/client?device_id=<id>` with the same API key.
- Text or binary WebSocket messages are forwarded to the opposite side in the
  same user/device room.
- Different users are isolated by API key.

Run locally:

```bash
cd services/relay
go run . -addr 0.0.0.0:8909
```

Protect the admin UI/API before exposing the server:

```bash
cd services/relay
CODEP_RELAY_ADMIN_TOKEN=change-me go run .
```

Health and discovery:

```bash
curl http://127.0.0.1:8909/healthz
curl -H 'X-CodeP-Admin-Token: change-me' http://127.0.0.1:8909/api/devices
```

For LAN testing, use the workstation IP from the phone browser, for example:

```text
http://192.168.1.20:8909/healthz
```
