import { CodexAdapter, type CodexAdapterEvent } from "@codep/codex-adapter";
import type {
  BridgeOutboundMessage,
  CodexTurnStartMessage,
  WorkspaceRecord
} from "./types.js";
import { WorkspaceManager } from "./workspace.js";

export type BridgeSend = (message: BridgeOutboundMessage) => void;

interface ActiveRun {
  runId: string;
  threadId: string;
  turnId?: string;
  requestId?: string;
  record: WorkspaceRecord;
  seq: number;
}

export class CodexRunManager {
  private adapter: CodexAdapter | null = null;
  private connecting: Promise<CodexAdapter> | null = null;
  private readonly activeByRun = new Map<string, ActiveRun>();
  private readonly activeByThread = new Map<string, ActiveRun>();

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly send: BridgeSend,
    private readonly codexCommand?: string
  ) {}

  async startTurn(message: CodexTurnStartMessage): Promise<void> {
    const record = await this.workspaceManager.ensureFromMessage(message);
    const adapter = await this.ensureAdapter();
    const threadId = await this.ensureThread(adapter, record, message);

    const run: ActiveRun = {
      runId: message.run_id,
      threadId,
      requestId: message.request_id,
      record,
      seq: 0
    };
    this.activeByRun.set(run.runId, run);
    this.activeByThread.set(threadId, run);

    try {
      const started = await adapter.startTurn(threadId, message.content, {
        cwd: record.workspacePath,
        model: message.options?.model,
        effort: normalizeEffort(message.options?.effort),
        approvalPolicy: message.options?.approval_policy ?? "never",
        permissionProfile: "full-access",
        sandboxPolicy: sandboxPolicyFor(message.options?.sandbox)
      });
      run.turnId = started.turn.id;
      this.send({
        type: "codex.started",
        request_id: message.request_id,
        run_id: run.runId,
        channel_id: message.channel_id,
        thread_id: threadId,
        turn_id: run.turnId,
        workspace_path: record.workspacePath
      });
    } catch (error) {
      this.activeByRun.delete(run.runId);
      this.activeByThread.delete(threadId);
      this.sendFailure(run, "codex_turn_start_failed", error);
    }
  }

  async interrupt(runId: string, reason?: string): Promise<void> {
    const run = this.activeByRun.get(runId);
    if (!run) {
      this.send({
        type: "codex.interrupt_ignored",
        run_id: runId,
        reason: "run not active"
      });
      return;
    }

    const adapter = await this.ensureAdapter();
    if (!run.turnId) {
      this.send({
        type: "codex.interrupt_ignored",
        run_id: runId,
        reason: "turn not started"
      });
      return;
    }

    try {
      await adapter.interruptTurn(run.threadId, run.turnId);
      this.send({
        type: "codex.interrupted",
        run_id: runId,
        reason: reason ?? "interrupted"
      });
    } catch (error) {
      this.sendFailure(run, "codex_interrupt_failed", error);
    }
  }

  async stop(): Promise<void> {
    await this.adapter?.disconnect();
    this.adapter = null;
    this.connecting = null;
    this.activeByRun.clear();
    this.activeByThread.clear();
  }

  private async ensureThread(
    adapter: CodexAdapter,
    record: WorkspaceRecord,
    message: CodexTurnStartMessage
  ): Promise<string> {
    const session = await this.workspaceManager.readSession(record);
    if (session.threadId) {
      return session.threadId;
    }

    const started = await adapter.startThread({
      cwd: record.workspacePath,
      model: message.options?.model,
      approvalPolicy: message.options?.approval_policy ?? "never",
      permissionProfile: "full-access",
      sandbox: message.options?.sandbox ?? "danger-full-access",
      runtimeWorkspaceRoots: [record.workspacePath],
      ephemeral: false
    });
    await this.workspaceManager.writeSession(record, {
      threadId: started.thread.id
    });
    return started.thread.id;
  }

  private async ensureAdapter(): Promise<CodexAdapter> {
    if (this.adapter) {
      return this.adapter;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = (async () => {
      const adapter = new CodexAdapter({
        codexCommand: this.codexCommand,
        requestTimeoutMs: 60_000,
        startupTimeoutMs: 20_000
      });
      adapter.on("event", event => {
        this.handleCodexEvent(adapter, event);
      });
      adapter.on("error", error => {
        this.send({
          type: "codex.adapter_error",
          error: error.message
        });
      });
      adapter.on("close", () => {
        this.send({
          type: "codex.adapter_closed"
        });
        this.adapter = null;
        this.connecting = null;
      });
      await adapter.connect();
      this.adapter = adapter;
      this.send({ type: "codex.app_server.ready" });
      return adapter;
    })();

    return this.connecting;
  }

  private handleCodexEvent(adapter: CodexAdapter, event: CodexAdapterEvent): void {
    if (event.type === "approval.requested") {
      adapter.rejectServerRequest(
        event.requestId,
        "BeeSeed Codex Bridge P0 runs with approvalPolicy=never and does not support approvals."
      );
      const run = event.threadId ? this.activeByThread.get(event.threadId) : undefined;
      if (run) {
        this.finishRun(run, "failed", {
          failure_code: "approval_unexpected",
          failure_detail: "Codex requested approval while this bridge is configured for Full Access."
        });
      }
      return;
    }

    const threadId = "threadId" in event ? event.threadId : "";
    const run = threadId ? this.activeByThread.get(threadId) : undefined;
    if (!run) {
      return;
    }

    run.seq += 1;
    this.send({
      type: "codex.event",
      run_id: run.runId,
      seq: run.seq,
      event: eventWithoutRaw(event)
    });

    if (event.type === "turn.started") {
      run.turnId = event.turnId;
      return;
    }

    if (event.type === "turn.completed") {
      this.finishRun(run, "completed", {
        summary: "Codex turn completed."
      });
    }
  }

  private finishRun(
    run: ActiveRun,
    status: "completed" | "failed",
    extra: Record<string, unknown>
  ): void {
    this.activeByRun.delete(run.runId);
    this.activeByThread.delete(run.threadId);
    this.send({
      type: status === "completed" ? "codex.completed" : "codex.failed",
      run_id: run.runId,
      channel_id: run.record.channelId,
      thread_id: run.threadId,
      turn_id: run.turnId,
      status,
      ...extra
    });
  }

  private sendFailure(run: ActiveRun, failureCode: string, error: unknown): void {
    this.finishRun(run, "failed", {
      failure_code: failureCode,
      failure_detail: error instanceof Error ? error.message : String(error)
    });
  }
}

function eventWithoutRaw(event: CodexAdapterEvent): Record<string, unknown> {
  const copy = { ...event } as Record<string, unknown>;
  delete copy.raw;
  return copy;
}

function normalizeEffort(value: string | null | undefined) {
  switch (value) {
    case "none":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return value;
    default:
      return undefined;
  }
}

function sandboxPolicyFor(value: string | undefined) {
  if (value === "danger-full-access" || value === undefined) {
    return { type: "dangerFullAccess" };
  }
  if (value === "read-only") {
    return { type: "readOnly" };
  }
  return { type: "workspaceWrite" };
}
