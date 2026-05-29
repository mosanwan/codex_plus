#!/usr/bin/env node
import { BeeSeedCodexBridge, defaultBridgeRoot } from "./bridge.js";

const wsUrl = process.env.BEESEED_BRIDGE_WS_URL;
const token = process.env.BEESEED_BRIDGE_TOKEN;

if (!wsUrl || !token) {
  console.error(
    [
      "BeeSeed Codex Bridge requires:",
      "",
      "  BEESEED_BRIDGE_WS_URL=wss://<worker>/api/codex-bridge/ws",
      "  BEESEED_BRIDGE_TOKEN=<device-token>",
      "",
      "Optional:",
      "  BEESEED_CODEX_ROOT=~/.beeseed-codex",
      "  BEESEED_CODEX_COMMAND=codex"
    ].join("\n")
  );
  process.exit(2);
}

const bridge = new BeeSeedCodexBridge({
  wsUrl,
  token,
  rootDir: process.env.BEESEED_CODEX_ROOT || defaultBridgeRoot(),
  codexCommand: process.env.BEESEED_CODEX_COMMAND
});

bridge.on("log", message => {
  console.log(`[beeseed-bridge] ${message}`);
});
bridge.on("error", error => {
  console.error(`[beeseed-bridge] ${error.message}`);
});

bridge.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void bridge.stop().finally(() => {
      process.exit(0);
    });
  });
}
