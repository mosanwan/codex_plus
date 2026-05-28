import type {
  CodexAdapterEvent,
  ModelListResponse,
  ThreadListResponse,
  ThreadStartResponse,
  TurnStartResponse,
  JsonObject,
  UserInput
} from "@codep/codex-adapter";

export interface ComposerAttachment {
  id: string;
  type: "localImage" | "mention";
  path: string;
  name: string;
  previewDataUrl?: string;
}

export interface ClipboardAttachmentResult {
  attachments: ComposerAttachment[];
  formats: string[];
}

export type RemoteAttachmentInput =
  | {
      kind: "image";
      name: string;
      mimeType: string;
      dataUrl: string;
    }
  | {
      kind: "mention";
      name: string;
      path: string;
    };

export interface ComposerSuggestion {
  id: string;
  type: "file" | "skill";
  label: string;
  name: string;
  detail?: string;
  insertText: string;
  path?: string;
}

export interface WorkspaceFilePreview {
  path: string;
  relativePath: string;
  name: string;
  content: string;
  size: number;
  truncated: boolean;
}

export interface NotificationSoundFile {
  path: string;
  url: string;
  name: string;
}

export interface DesktopUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadUrl?: string;
  downloadedPath?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  checkedAt: number;
}

export type PeriodicTaskSessionMode = "existing" | "create_once";
export type PeriodicTaskStatus = "idle" | "waiting" | "running" | "paused" | "error";
export type PeriodicTaskPermissionMode = "default" | "auto-review" | "full-access";
export type PeriodicTaskTrigger = "interval" | "schedule";
export type PeriodicTaskScheduleFrequency = "daily" | "weekly";

export interface PeriodicTask {
  id: string;
  name: string;
  enabled: boolean;
  workspace: string;
  sessionMode: PeriodicTaskSessionMode;
  sessionId?: string;
  prompt: string;
  trigger: PeriodicTaskTrigger;
  intervalMs: number;
  scheduleFrequency: PeriodicTaskScheduleFrequency;
  scheduleTime: string;
  scheduleWeekdays: number[];
  model?: string;
  effort?: string | null;
  permissionMode: PeriodicTaskPermissionMode;
  nextRunAt?: number;
  lastRunAt?: number;
  lastCompletedAt?: number;
  lastError?: string;
  status: PeriodicTaskStatus;
  activeTurnId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PeriodicTaskInput {
  name: string;
  enabled?: boolean;
  workspace: string;
  sessionMode: PeriodicTaskSessionMode;
  sessionId?: string;
  prompt: string;
  trigger?: PeriodicTaskTrigger;
  intervalMs: number;
  scheduleFrequency?: PeriodicTaskScheduleFrequency;
  scheduleTime?: string;
  scheduleWeekdays?: number[];
  model?: string;
  effort?: string | null;
  permissionMode?: PeriodicTaskPermissionMode;
}

declare global {
  interface Window {
    codexApp: {
      chooseWorkspace(): Promise<string | null>;
      connect(): Promise<{
        userAgent: string;
        codexHome: string;
        platformFamily: string;
        platformOs: string;
      }>;
      disconnect(): Promise<void>;
      readClipboardAttachments(): Promise<ClipboardAttachmentResult>;
      chooseAttachmentFiles(): Promise<ComposerAttachment[]>;
      chooseNotificationSoundFile(): Promise<NotificationSoundFile | null>;
      checkForUpdates(): Promise<DesktopUpdateInfo>;
      openUpdateDownload(url: string): Promise<void>;
      revealDownloadedUpdate(path: string): Promise<void>;
      searchWorkspaceFiles(options: {
        cwd: string;
        query?: string;
        limit?: number;
      }): Promise<ComposerSuggestion[]>;
      previewWorkspaceFile(options: {
        cwd: string;
        path: string;
        maxBytes?: number;
      }): Promise<WorkspaceFilePreview>;
      searchSkills(options?: {
        cwd?: string;
        query?: string;
        limit?: number;
        forceReload?: boolean;
      }): Promise<ComposerSuggestion[]>;
      saveRemoteAttachments(
        attachments: RemoteAttachmentInput[]
      ): Promise<ComposerAttachment[]>;
      startThread(options: {
        cwd: string;
        model?: string;
        serviceTier?: string | null;
        effort?: string | null;
        approvalPolicy?: string;
        approvalsReviewer?: string;
        permissionProfile?: string;
        sandbox?: string;
      }): Promise<ThreadStartResponse>;
      listThreads(options: { cwd: string }): Promise<ThreadListResponse>;
      listModels(options?: {
        includeHidden?: boolean;
        limit?: number;
      }): Promise<ModelListResponse>;
      getStatus(): Promise<unknown>;
      renameThread(options: {
        threadId: string;
        name: string;
      }): Promise<unknown>;
      resumeThread(options: {
        threadId: string;
        cwd: string;
        model?: string;
        serviceTier?: string | null;
        effort?: string | null;
        approvalPolicy?: string;
        approvalsReviewer?: string;
        permissionProfile?: string;
        sandbox?: string;
      }): Promise<ThreadStartResponse>;
      startTurn(options: {
        threadId: string;
        text: string;
        input?: UserInput[];
        model?: string;
        serviceTier?: string | null;
        effort?: string | null;
        approvalPolicy?: string;
        approvalsReviewer?: string;
        permissionProfile?: string;
        sandboxPolicy?: JsonObject;
      }): Promise<TurnStartResponse>;
      interruptTurn(options: {
        threadId: string;
        turnId: string;
      }): Promise<unknown>;
      resolveApproval(options: {
        requestId: string | number;
        decision: "accept" | "decline" | "cancel";
      }): Promise<void>;
      listPeriodicTasks(): Promise<PeriodicTask[]>;
      createPeriodicTask(input: PeriodicTaskInput): Promise<PeriodicTask>;
      updatePeriodicTask(options: {
        taskId: string;
        patch: Partial<PeriodicTaskInput>;
      }): Promise<PeriodicTask>;
      deletePeriodicTask(options: { taskId: string }): Promise<void>;
      runPeriodicTaskNow(options: { taskId: string }): Promise<PeriodicTask>;
      onPeriodicTasksUpdated(
        listener: (tasks: PeriodicTask[]) => void
      ): () => void;
      onEvent(listener: (event: CodexAdapterEvent) => void): () => void;
    };
  }
}

export {};
