#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const relayDir = resolve(repoRoot, "services/relay");
const target = process.env.CODEP_RELAY_DEPLOY_TARGET;
const serviceName = process.env.CODEP_RELAY_DEPLOY_SERVICE || "codep-relay";
const remoteBinary = process.env.CODEP_RELAY_DEPLOY_REMOTE_BINARY || "/opt/codep-relay/codep-relay";
const remoteTempBinary = process.env.CODEP_RELAY_DEPLOY_REMOTE_TEMP || "/tmp/codep-relay.new";
const localBinary = process.env.CODEP_RELAY_DEPLOY_LOCAL_BINARY || "/tmp/codep-relay";
const localHealthURL = process.env.CODEP_RELAY_DEPLOY_LOCAL_HEALTH_URL || "http://127.0.0.1:8909/healthz";
const publicHealthURL = process.env.CODEP_RELAY_DEPLOY_PUBLIC_HEALTH_URL;

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

if (!target) {
  console.error("CODEP_RELAY_DEPLOY_TARGET is required, for example user@example.com or an SSH config alias.");
  process.exit(1);
}

console.log(`Deploying Codex+ Relay to SSH target ${target}`);
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

const remoteCommands = [
  "set -e",
  `install -o root -g root -m 0755 ${remoteTempBinary} ${remoteBinary}.new`,
  `systemctl stop ${serviceName}`,
  `if [ -f ${remoteBinary} ]; then cp -a ${remoteBinary} ${remoteBinary}.bak.$(date +%Y%m%d%H%M%S); fi`,
  `mv ${remoteBinary}.new ${remoteBinary}`,
  `systemctl start ${serviceName}`,
  `systemctl is-active ${serviceName}`,
  `for i in $(seq 1 20); do curl -fsS ${localHealthURL} >/dev/null 2>&1 && break; sleep 0.5; done`,
  `curl -fsS ${localHealthURL}`
];

if (publicHealthURL) {
  remoteCommands.push(
    `for i in $(seq 1 20); do curl -fsS ${publicHealthURL} >/dev/null 2>&1 && break; sleep 0.5; done`,
    `curl -fsS ${publicHealthURL}`
  );
}

run("scp", ["-o", "BatchMode=yes", localBinary, `${target}:${remoteTempBinary}`]);
run("ssh", [
  "-o",
  "BatchMode=yes",
  target,
  remoteCommands.join("; ")
]);
