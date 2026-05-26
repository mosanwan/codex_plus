import { EventEmitter } from "node:events";
import { CodexAppServerProcess } from "./app-server-process.js";
import {
  normalizeNotification,
  normalizeServerRequest,
  type CodexAdapterEvent
} from "./events.js";
import { JsonRpcClient } from "./json-rpc-client.js";
import type {
  ClientInfo,
  CodexAdapterOptions,
  CodexNotification,
  CodexServerRequest,
  InitializeResponse,
  RequestId,
  ThreadStartOptions,
  ThreadStartResponse,
  ThreadResumeOptions,
  ThreadResumeResponse,
  ThreadListOptions,
  ThreadListResponse,
  ModelListResponse,
  CodexStatusResponse,
  ThreadNameSetResponse,
  TurnStartOptions,
  TurnStartResponse,
  UserInput
} from "./types.js";

export interface CodexAdapterEvents {
  event: [CodexAdapterEvent];
  notification: [CodexNotification];
  serverRequest: [CodexServerRequest];
  error: [Error];
  close: [];
}

export class CodexAdapter {
  private readonly emitter = new EventEmitter();
  private appServer: CodexAppServerProcess | null = null;
  private rpc: JsonRpcClient | null = null;

  constructor(private readonly options: CodexAdapterOptions = {}) {}

  async connect(): Promise<InitializeResponse> {
    if (this.rpc) {
      throw new Error("CodexAdapter is already connected");
    }

    this.appServer = await CodexAppServerProcess.start({
      codexCommand: this.options.codexCommand,
      port: this.options.port,
      startupTimeoutMs: this.options.startupTimeoutMs
    });

    const rpc = new JsonRpcClient(
      this.appServer.url,
      this.options.requestTimeoutMs ?? 30_000
    );
    this.rpc = rpc;

    rpc.on("notification", notification => {
      this.emitter.emit("notification", notification);
      this.emitter.emit("event", normalizeNotification(notification));
    });
    rpc.on("serverRequest", request => {
      this.emitter.emit("serverRequest", request);
      this.emitter.emit("event", normalizeServerRequest(request));
    });
    rpc.on("error", error => {
      this.emitter.emit("error", error);
    });
    rpc.on("close", () => {
      this.emitter.emit("close");
    });

    await rpc.connect();
    const response = await rpc.request<InitializeResponse>("initialize", {
      clientInfo: this.clientInfo(),
      capabilities: {
        experimentalApi: true,
        requestAttestation: false
      }
    });
    rpc.notify("initialized");
    return response;
  }

  async disconnect(): Promise<void> {
    this.rpc?.close();
    this.rpc = null;
    await this.appServer?.stop();
    this.appServer = null;
  }

  on<K extends keyof CodexAdapterEvents>(
    event: K,
    listener: (...args: CodexAdapterEvents[K]) => void
  ): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  startThread(options: ThreadStartOptions = {}): Promise<ThreadStartResponse> {
    return this.request("thread/start", {
      ...definedOnly({
        cwd: options.cwd,
        model: options.model,
        modelProvider: options.modelProvider,
        serviceTier: options.serviceTier,
        approvalPolicy: options.approvalPolicy,
        approvalsReviewer: options.approvalsReviewer,
        permissionProfile: options.permissionProfile,
        sandbox: options.sandbox,
        runtimeWorkspaceRoots: options.runtimeWorkspaceRoots,
        config: mergeConfig(options.config, options.effort),
        ephemeral: options.ephemeral
      }),
      experimentalRawEvents: true,
      persistExtendedHistory: true
    });
  }

  resumeThread(
    threadId: string,
    options: ThreadResumeOptions = {}
  ): Promise<ThreadResumeResponse> {
    return this.request("thread/resume", {
      threadId,
      ...definedOnly({
        cwd: options.cwd,
        model: options.model,
        modelProvider: options.modelProvider,
        serviceTier: options.serviceTier,
        approvalPolicy: options.approvalPolicy,
        approvalsReviewer: options.approvalsReviewer,
        permissionProfile: options.permissionProfile,
        sandbox: options.sandbox,
        runtimeWorkspaceRoots: options.runtimeWorkspaceRoots,
        config: mergeConfig(options.config, options.effort),
        excludeTurns: options.excludeTurns ?? true
      }),
      experimentalRawEvents: true,
      persistExtendedHistory: true
    });
  }

  startTurn(
    threadId: string,
    text: string,
    options: TurnStartOptions = {}
  ): Promise<TurnStartResponse> {
    return this.startTurnWithInput(
      threadId,
      [{ type: "text", text, text_elements: [] }],
      options
    );
  }

  startTurnWithInput(
    threadId: string,
    input: UserInput[],
    options: TurnStartOptions = {}
  ): Promise<TurnStartResponse> {
    return this.request("turn/start", {
      threadId,
      input,
      ...definedOnly({
        cwd: options.cwd,
        model: options.model,
        serviceTier: options.serviceTier,
        effort: options.effort,
        approvalPolicy: options.approvalPolicy,
        approvalsReviewer: options.approvalsReviewer,
        permissionProfile: options.permissionProfile,
        sandboxPolicy: options.sandboxPolicy
      })
    });
  }

  interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  readThread(threadId: string, includeTurns = true): Promise<unknown> {
    return this.request("thread/read", { threadId, includeTurns });
  }

  setThreadName(threadId: string, name: string): Promise<ThreadNameSetResponse> {
    return this.request("thread/name/set", { threadId, name });
  }

  listThreads(options: ThreadListOptions = {}): Promise<ThreadListResponse> {
    return this.request(
      "thread/list",
      definedOnly({
        cwd: options.cwd,
        limit: options.limit,
        cursor: options.cursor,
        sortKey: options.sortKey ?? "updated_at",
        sortDirection: options.sortDirection ?? "desc",
        archived: options.archived ?? false,
        sourceKinds: options.sourceKinds,
        searchTerm: options.searchTerm,
        useStateDbOnly: options.useStateDbOnly
      })
    );
  }

  listModels(options: { includeHidden?: boolean; limit?: number } = {}): Promise<ModelListResponse> {
    return this.request(
      "model/list",
      definedOnly({
        includeHidden: options.includeHidden,
        limit: options.limit
      })
    );
  }

  getStatus(): Promise<CodexStatusResponse> {
    return this.request("status");
  }

  resolveServerRequest<T>(id: RequestId, result: T): void {
    this.requireRpc().respond(id, result);
  }

  rejectServerRequest(
    id: RequestId,
    message: string,
    code = -32000,
    data?: unknown
  ): void {
    this.requireRpc().respondError(id, code, message, data);
  }

  private request<T>(method: string, params?: unknown): Promise<T> {
    return this.requireRpc().request<T>(method, params);
  }

  private requireRpc(): JsonRpcClient {
    if (!this.rpc) {
      throw new Error("CodexAdapter is not connected");
    }
    return this.rpc;
  }

  private clientInfo(): ClientInfo {
    return (
      this.options.clientInfo ?? {
        name: "codep-desktop",
        title: "Codex+ Desktop",
        version: "0.1.0"
      }
    );
  }
}

function definedOnly<T extends Record<string, unknown>>(object: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

function mergeConfig(
  config: ThreadStartOptions["config"],
  effort: ThreadStartOptions["effort"]
): ThreadStartOptions["config"] {
  if (effort === undefined) {
    return config;
  }

  return {
    ...(config ?? {}),
    model_reasoning_effort: effort
  };
}
