export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export interface BridgeOptions {
  wsUrl: string;
  token: string;
  rootDir: string;
  codexCommand?: string;
  heartbeatIntervalMs?: number;
  reconnectDelayMs?: number;
}

export interface SkillFileSpec {
  path: string;
  content: string;
}

export interface SkillSpec {
  id: string;
  version?: string;
  files: SkillFileSpec[];
}

export interface WorkspaceSpec {
  title?: string;
  agents_md?: string;
  skills?: SkillSpec[];
  mcp_config?: JsonValue;
}

export interface ChannelEnsureWorkspaceMessage {
  type: "channel.ensure_workspace";
  request_id: string;
  app_id: string;
  channel_id: string;
  agent_id: string;
  workspace_spec?: WorkspaceSpec;
}

export interface CodexTurnStartMessage {
  type: "codex.turn.start";
  request_id?: string;
  run_id: string;
  app_id: string;
  channel_id: string;
  agent_id: string;
  user_id?: string;
  message_id?: number;
  content: string;
  options?: {
    approval_policy?: string;
    sandbox?: string;
    model?: string;
    effort?: string | null;
  };
}

export interface CodexTurnInterruptMessage {
  type: "codex.turn.interrupt";
  run_id: string;
  reason?: string;
}

export type WorkerMessage =
  | ChannelEnsureWorkspaceMessage
  | CodexTurnStartMessage
  | CodexTurnInterruptMessage
  | { type?: string; [key: string]: unknown };

export interface WorkspaceRecord {
  appId: string;
  channelId: string;
  agentId: string;
  workspacePath: string;
  codexHomePath: string;
  sessionPath: string;
}

export interface BridgeOutboundMessage {
  type: string;
  [key: string]: unknown;
}
