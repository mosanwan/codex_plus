export type RequestId = string | number;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue | undefined };

export interface JsonRpcRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  id: RequestId;
  result: T;
}

export interface JsonRpcError {
  id: RequestId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse
  | JsonRpcError;

export interface ClientInfo {
  name: string;
  title: string | null;
  version: string;
}

export interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export interface Thread {
  id: string;
  sessionId: string;
  preview: string;
  cwd: string;
  status: string | JsonValue;
  path: string | null;
  createdAt: number;
  updatedAt: number;
  name: string | null;
  turns: Turn[];
}

export interface Turn {
  id: string;
  status: string;
  input?: unknown[];
  items?: unknown[];
}

export interface ThreadStartResponse {
  thread: Thread;
  model: string;
  modelProvider: string;
  serviceTier?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  cwd: string;
}

export interface ThreadResumeResponse extends ThreadStartResponse {}

export interface ThreadListResponse {
  data: Thread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface ModelSummary {
  id?: string;
  model?: string;
  slug?: string;
  displayName?: string;
  display_name?: string;
  hidden?: boolean;
  visibility?: string;
  defaultReasoningEffort?: ReasoningEffort;
  default_reasoning_level?: ReasoningEffort;
  isDefault?: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: ReasoningEffort;
    description: string;
  }>;
}

export interface ModelListResponse {
  data: ModelSummary[];
  nextCursor: string | null;
}

export type CodexStatusResponse = unknown;

export interface TurnStartResponse {
  turn: Turn;
}

export interface ThreadNameSetResponse {}

export interface UserTextInput {
  type: "text";
  text: string;
  text_elements: unknown[];
}

export type UserInput =
  | UserTextInput
  | { type: "image"; url: string; detail?: string }
  | { type: "localImage"; path: string; detail?: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export interface CodexAdapterOptions {
  codexCommand?: string;
  port?: number;
  clientInfo?: ClientInfo;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface ThreadStartOptions {
  cwd?: string;
  model?: string;
  modelProvider?: string;
  serviceTier?: string | null;
  effort?: ReasoningEffort | null;
  approvalPolicy?: string;
  approvalsReviewer?: string;
  permissionProfile?: string;
  sandbox?: string;
  runtimeWorkspaceRoots?: string[];
  config?: JsonObject;
  ephemeral?: boolean;
}

export interface ThreadResumeOptions {
  cwd?: string;
  model?: string;
  modelProvider?: string;
  serviceTier?: string | null;
  effort?: ReasoningEffort | null;
  approvalPolicy?: string;
  approvalsReviewer?: string;
  permissionProfile?: string;
  sandbox?: string;
  runtimeWorkspaceRoots?: string[];
  config?: JsonObject;
  excludeTurns?: boolean;
}

export interface ThreadListOptions {
  cwd?: string | string[];
  limit?: number;
  cursor?: string;
  sortKey?: "created_at" | "updated_at";
  sortDirection?: "asc" | "desc";
  archived?: boolean;
  sourceKinds?: string[];
  searchTerm?: string;
  useStateDbOnly?: boolean;
}

export interface TurnStartOptions {
  cwd?: string;
  model?: string;
  serviceTier?: string | null;
  effort?: ReasoningEffort | null;
  approvalPolicy?: string;
  approvalsReviewer?: string;
  permissionProfile?: string;
  sandboxPolicy?: JsonObject;
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface CodexNotification {
  method: string;
  params?: unknown;
}

export interface CodexServerRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}
