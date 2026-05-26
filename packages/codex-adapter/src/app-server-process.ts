import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";

export interface CodexAppServerProcessOptions {
  codexCommand?: string;
  port?: number;
  startupTimeoutMs?: number;
}

export class CodexAppServerProcess {
  private child: ChildProcess | null = null;
  private logs = "";

  readonly port: number;
  readonly url: string;

  private constructor(
    private readonly options: Required<CodexAppServerProcessOptions>
  ) {
    this.port = options.port;
    this.url = `ws://127.0.0.1:${this.port}`;
  }

  static async start(
    options: CodexAppServerProcessOptions = {}
  ): Promise<CodexAppServerProcess> {
    const port = options.port ?? (await findFreePort());
    const process = new CodexAppServerProcess({
      codexCommand: options.codexCommand ?? "codex",
      port,
      startupTimeoutMs: options.startupTimeoutMs ?? 10_000
    });
    await process.start();
    return process;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }

    this.child = null;

    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        killProcessGroup(child.pid, "SIGKILL");
        resolve();
      }, 2_000);

      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });

      killProcessGroup(child.pid, "SIGTERM");

      if (child.exitCode !== null || child.signalCode !== null) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  getRecentLogs(): string {
    return this.logs.slice(-4_000);
  }

  private async start(): Promise<void> {
    const child = spawn(
      this.options.codexCommand,
      ["app-server", "--listen", this.url],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: runtimeEnv()
      }
    );

    this.child = child;

    child.stdout.on("data", chunk => {
      this.appendLogs(chunk);
    });
    child.stderr.on("data", chunk => {
      this.appendLogs(chunk);
    });

    await waitForReady({
      readyUrl: `http://127.0.0.1:${this.port}/readyz`,
      timeoutMs: this.options.startupTimeoutMs,
      isExited: () => child.exitCode !== null || child.signalCode !== null,
      getLogs: () => this.getRecentLogs()
    });
  }

  private appendLogs(chunk: Buffer): void {
    this.logs += chunk.toString("utf8");
    if (this.logs.length > 16_000) {
      this.logs = this.logs.slice(-8_000);
    }
  }
}

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy"
] as const;

function runtimeEnv(): NodeJS.ProcessEnv {
  const baseEnv = {
    ...process.env,
    PATH: runtimePath()
  };

  return {
    ...baseEnv,
    ...shellProxyEnv(baseEnv)
  };
}

function runtimePath(): string {
  const entries = [
    process.env.PATH,
    path.join(homedir(), ".local", "bin"),
    path.join(homedir(), ".npm-global", "bin"),
    path.join(homedir(), ".yarn", "bin"),
    ...nvmNodeBins()
  ].filter((entry): entry is string => Boolean(entry));

  return Array.from(new Set(entries.flatMap(entry => entry.split(":").filter(Boolean)))).join(":");
}

function nvmNodeBins(): string[] {
  const versionsDir = path.join(homedir(), ".nvm", "versions", "node");
  if (!existsSync(versionsDir)) {
    return [];
  }

  return readdirSync(versionsDir)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    .map(version => path.join(versionsDir, version, "bin"))
    .filter(entry => existsSync(entry));
}

function shellProxyEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (PROXY_ENV_KEYS.some(key => baseEnv[key])) {
    return {};
  }

  const shell = process.env.SHELL || "/bin/bash";
  if (!existsSync(shell)) {
    return {};
  }

  try {
    const output = execFileSync(shell, ["-ic", "env"], {
      env: baseEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_500
    });
    return parseProxyEnv(output);
  } catch {
    return {};
  }
}

function parseProxyEnv(output: string): NodeJS.ProcessEnv {
  const proxyEnv: NodeJS.ProcessEnv = {};

  for (const line of output.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator);
    if (!isProxyEnvKey(key)) {
      continue;
    }

    proxyEnv[key] = line.slice(separator + 1);
  }

  return proxyEnv;
}

function isProxyEnvKey(value: string): value is (typeof PROXY_ENV_KEYS)[number] {
  return PROXY_ENV_KEYS.includes(value as (typeof PROXY_ENV_KEYS)[number]);
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) {
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Process already exited.
    }
  }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a local port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForReady(options: {
  readyUrl: string;
  timeoutMs: number;
  isExited: () => boolean;
  getLogs: () => string;
}): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    if (options.isExited()) {
      throw new Error(
        `codex app-server exited before becoming ready.\n${options.getLogs()}`
      );
    }

    try {
      const response = await fetch(options.readyUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the app-server binds the port.
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for codex app-server readiness at ${options.readyUrl}.\n${options.getLogs()}`
  );
}
