#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const relayDir = resolve(repoRoot, "services/relay");
const target = process.env.CODEP_RELAY_DEPLOY_TARGET || "prod";
const remoteBinary = "/opt/codep-relay/codep-relay";
const localBinary = "/tmp/codep-relay";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function requireFile(path, hint) {
  if (!existsSync(path)) {
    console.error(`${path} not found. ${hint}`);
    process.exit(1);
  }
}

requireFile(resolve(process.env.HOME || "", ".ssh/config"), "Configure SSH first.");

console.log(`Deploying CodeP relay to SSH target ${target}`);
run("go", ["test", "./..."], { cwd: relayDir });
run(
  "go",
  ["build", "-o", localBinary, "./"],
  {
    cwd: relayDir,
    env: {
      ...process.env,
      GOOS: "linux",
      GOARCH: "amd64",
      CGO_ENABLED: "0"
    }
  }
);

run("scp", ["-o", "BatchMode=yes", localBinary, `${target}:/tmp/codep-relay.new`]);
run("ssh", [
  "-o",
  "BatchMode=yes",
  target,
  [
    "set -e",
    "install -o root -g root -m 0755 /tmp/codep-relay.new /opt/codep-relay/codep-relay.new",
    "systemctl stop codep-relay",
    `cp -a ${remoteBinary} ${remoteBinary}.bak.$(date +%Y%m%d%H%M%S)`,
    `mv /opt/codep-relay/codep-relay.new ${remoteBinary}`,
    "systemctl start codep-relay",
    "systemctl is-active codep-relay",
    "for i in $(seq 1 20); do curl -fsS http://127.0.0.1:8909/healthz >/dev/null 2>&1 && break; sleep 0.5; done",
    "curl -fsS http://127.0.0.1:8909/healthz",
    "for i in $(seq 1 20); do curl -fsS https://codex-bridge.three.ink/healthz >/dev/null 2>&1 && break; sleep 0.5; done",
    "curl -fsS https://codex-bridge.three.ink/healthz"
  ].join("; ")
]);
