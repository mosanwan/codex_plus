# @codep/codex-adapter

Prototype adapter for the local Codex app-server protocol.

This package owns the integration boundary with:

```bash
codex app-server --listen ws://127.0.0.1:<port>
```

It is intended to run from the Electron main process, not from the React renderer.

## Current Capabilities

- Start and stop `codex app-server`.
- Connect over local WebSocket.
- Run `initialize` and send `initialized`.
- Create a persistent thread with `thread/start`.
- Start a turn with `turn/start`.
- Receive server notifications.
- Receive server-initiated JSON-RPC requests, including approval requests.
- Respond to server requests.
- Interrupt a running turn.

## Probe

From the repository root:

```bash
npm run probe:adapter
```

The default probe only validates `initialize` and `thread/start`. To also send a real turn:

```bash
npm run probe:adapter -- --turn "Say hello briefly."
```

The `--turn` mode may call the model and consume account quota.
