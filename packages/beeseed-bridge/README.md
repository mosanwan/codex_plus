# BeeSeed Codex Bridge

Local connector for running Codex from a BeeSeed channel without using OpenAI API key billing.

The bridge connects to a BeeSeed Worker over WSS, creates one local workspace per channel, keeps the local Codex app-server private, and streams Codex events back to BeeSeed.

## Run

```bash
BEESEED_BRIDGE_WS_URL=wss://example.com/api/codex-bridge/ws \
BEESEED_BRIDGE_TOKEN=... \
npm run dev -w @codep/beeseed-bridge
```

Optional environment variables:

```text
BEESEED_CODEX_ROOT=~/.beeseed-codex
BEESEED_CODEX_COMMAND=codex
```

The first implementation supports:

- `channel.ensure_workspace`
- `codex.turn.start`
- `codex.turn.interrupt`
- workspace-local `AGENTS.md`
- skill file sync under `.beeseed/skills`
- raw MCP config snapshot under `.beeseed/mcp/config.json`
