import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import path from "node:path";
import { CodexRunManager } from "./codex-runner.js";
import type {
  BridgeOptions,
  BridgeOutboundMessage,
  ChannelEnsureWorkspaceMessage,
  CodexTurnInterruptMessage,
  CodexTurnStartMessage,
  WorkerMessage
} from "./types.js";
import { WorkspaceManager } from "./workspace.js";

export interface BeeSeedCodexBridgeEvents {
  log: [string];
  error: [Error];
}

export class BeeSeedCodexBridge {
  private readonly emitter = new EventEmitter();
  private readonly workspaceManager: WorkspaceManager;
  private readonly codex: CodexRunManager;
  private socket: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly options: BridgeOptions) {
    this.workspaceManager = new WorkspaceManager(options.rootDir);
    this.codex = new CodexRunManager(
      this.workspaceManager,
      message => this.send(message),
      options.codexCommand
    );
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnect) {
      clearTimeout(this.reconnect);
      this.reconnect = null;
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.socket?.close();
    this.socket = null;
    await this.codex.stop();
  }

  on<K extends keyof BeeSeedCodexBridgeEvents>(
    event: K,
    listener: (...args: BeeSeedCodexBridgeEvents[K]) => void
  ): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  private connect(): void {
    const url = bridgeUrlWithToken(this.options.wsUrl, this.options.token);
    this.log(`Connecting to BeeSeed Worker at ${redactUrlToken(url)}`);

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.log("BeeSeed Worker WSS connected.");
      this.sendReady();
      this.startHeartbeat();
    });
    socket.addEventListener("message", event => {
      void this.handleMessage(event.data);
    });
    socket.addEventListener("close", () => {
      this.log("BeeSeed Worker WSS closed.");
      this.socket = null;
      this.stopHeartbeat();
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      this.emitError(new Error("BeeSeed Worker WSS error"));
    });
  }

  private async handleMessage(data: unknown): Promise<void> {
    try {
      const message = JSON.parse(await messageDataToText(data)) as WorkerMessage;
      switch (message.type) {
        case "channel.ensure_workspace":
          await this.handleEnsureWorkspace(message as ChannelEnsureWorkspaceMessage);
          return;
        case "codex.turn.start":
          await this.handleTurnStart(message as CodexTurnStartMessage);
          return;
        case "codex.turn.interrupt":
          await this.handleTurnInterrupt(message as CodexTurnInterruptMessage);
          return;
        default:
          this.send({
            type: "bridge.message_ignored",
            reason: "unknown message type",
            worker_message_type: message.type ?? ""
          });
      }
    } catch (error) {
      this.send({
        type: "bridge.message_failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handleEnsureWorkspace(
    message: ChannelEnsureWorkspaceMessage
  ): Promise<void> {
    try {
      const record = await this.workspaceManager.ensureFromMessage(message);
      this.send({
        type: "workspace.ready",
        request_id: message.request_id,
        app_id: message.app_id,
        channel_id: message.channel_id,
        agent_id: message.agent_id,
        workspace_path: record.workspacePath,
        codex_home_path: record.codexHomePath
      });
    } catch (error) {
      this.send({
        type: "workspace.failed",
        request_id: message.request_id,
        app_id: message.app_id,
        channel_id: message.channel_id,
        agent_id: message.agent_id,
        failure_code: "workspace_ensure_failed",
        failure_detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handleTurnStart(message: CodexTurnStartMessage): Promise<void> {
    await this.codex.startTurn(message);
  }

  private async handleTurnInterrupt(
    message: CodexTurnInterruptMessage
  ): Promise<void> {
    await this.codex.interrupt(message.run_id, message.reason);
  }

  private sendReady(): void {
    this.send({
      type: "bridge.ready",
      root_dir: this.options.rootDir,
      capabilities: {
        codex_app_server: true,
        full_access: true,
        skills_sync: true,
        mcp_config: true
      }
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      this.send({
        type: "bridge.heartbeat",
        timestamp: new Date().toISOString()
      });
    }, this.options.heartbeatIntervalMs ?? 15_000);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) {
      return;
    }
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnect) {
      return;
    }
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      if (!this.stopped) {
        this.connect();
      }
    }, this.options.reconnectDelayMs ?? 3_000);
  }

  private send(message: BridgeOutboundMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.log(`Dropped bridge message while offline: ${message.type}`);
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private log(message: string): void {
    this.emitter.emit("log", message);
  }

  private emitError(error: Error): void {
    this.emitter.emit("error", error);
  }
}

export function defaultBridgeRoot(): string {
  return path.join(homedir(), ".beeseed-codex");
}

function bridgeUrlWithToken(wsUrl: string, token: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("bridge_token", token);
  return url.toString();
}

function redactUrlToken(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.searchParams.has("bridge_token")) {
    url.searchParams.set("bridge_token", "<redacted>");
  }
  return url.toString();
}

async function messageDataToText(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8"
    );
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return String(data);
}
