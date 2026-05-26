export type ViewMode = "sessions" | "chat" | "settings";
export type ConnectionState = "online" | "pairing" | "offline";
export type PermissionMode = "default" | "auto-review" | "full-access";
export type ModelEffort = "low" | "medium" | "high" | "xhigh";

export interface Device {
  id: string;
  name: string;
  workspace: string;
  connection: ConnectionState;
  lastSeen: string;
}

export interface Session {
  id: string;
  title: string;
  updatedAt: string;
  status: "ready" | "working" | "approval";
  iconId?: string;
  unread?: boolean;
  turnStartedAt?: number | null;
  lastTurnDurationMs?: number | null;
}

export interface Workspace {
  path: string;
  name: string;
  sessions: Session[];
}

export interface Message {
  id: string;
  role: "user" | "codex" | "event";
  text: string;
  meta?: string;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  kind: "image";
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface Approval {
  id: string;
  title: string;
  detail: string;
  risk: "medium" | "high";
}

export interface RemoteSnapshot {
  device: Device;
  workspaces: Workspace[];
  activeWorkspace: string | null;
  sessions: Session[];
  activeSessionId: string;
  messages: Message[];
  approvals: Approval[];
  diffLines: string[];
  permissionMode: PermissionMode;
  model: string;
  modelOptions?: Array<{ id: string; label: string }>;
  modelEffort: ModelEffort;
  contextUsage: {
    usedTokens: number;
    contextWindow: number | null;
  } | null;
  rateLimitUsage?: {
    primary: { leftPercent: number | null } | null;
    secondary: { leftPercent: number | null } | null;
  } | null;
  status?: string;
}

export interface RemoteClient {
  readSnapshot(): Promise<RemoteSnapshot>;
  sendMessage(sessionId: string, text: string): Promise<Message>;
  interruptTurn(sessionId: string): Promise<void>;
  resolveApproval(approvalId: string, decision: "approve" | "decline"): Promise<void>;
}

export const mockSnapshot: RemoteSnapshot = {
  device: {
    id: "desktop-main",
    name: "desktop",
    workspace: "",
    connection: "offline",
    lastSeen: ""
  },
  workspaces: [],
  activeWorkspace: null,
  sessions: [],
  activeSessionId: "",
  messages: [],
  approvals: [],
  diffLines: [],
  permissionMode: "default",
  model: "gpt-5.5",
  modelOptions: [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-codex", label: "GPT-5 Codex" }
  ],
  modelEffort: "high",
  contextUsage: null,
  rateLimitUsage: {
    primary: { leftPercent: null },
    secondary: { leftPercent: null }
  },
  status: ""
};
