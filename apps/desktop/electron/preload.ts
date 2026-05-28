import { contextBridge, ipcRenderer } from "electron";
import type { CodexAdapterEvent, JsonObject, UserInput } from "@codep/codex-adapter";

interface RemoteAttachmentInput {
  kind: "image";
  name: string;
  mimeType: string;
  dataUrl: string;
}

type PeriodicTaskSessionMode = "existing" | "create_once";
type PeriodicTaskStatus = "idle" | "waiting" | "running" | "paused" | "error";
type PeriodicTaskPermissionMode = "default" | "auto-review" | "full-access";
type PeriodicTaskTrigger = "interval" | "schedule";
type PeriodicTaskScheduleFrequency = "daily" | "weekly";

interface PeriodicTask {
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

interface PeriodicTaskInput {
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

interface DesktopUpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadUrl?: string;
  downloadedPath?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  checkedAt: number;
}

contextBridge.exposeInMainWorld("codexApp", {
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  readClipboardAttachments: () => ipcRenderer.invoke("attachment:clipboard"),
  chooseAttachmentFiles: () => ipcRenderer.invoke("attachment:choose"),
  chooseNotificationSoundFile: () => ipcRenderer.invoke("notification:sound:choose"),
  checkForUpdates: (): Promise<DesktopUpdateInfo> => ipcRenderer.invoke("app:update:check"),
  openUpdateDownload: (url: string) => ipcRenderer.invoke("app:update:open-download", url),
  revealDownloadedUpdate: (path: string) => ipcRenderer.invoke("app:update:reveal-download", path),
  searchWorkspaceFiles: (options: { cwd: string; query?: string; limit?: number }) =>
    ipcRenderer.invoke("composer:files:search", options),
  previewWorkspaceFile: (options: { cwd: string; path: string; maxBytes?: number }) =>
    ipcRenderer.invoke("workspace:file:preview", options),
  searchSkills: (options?: { cwd?: string; query?: string; limit?: number; forceReload?: boolean }) =>
    ipcRenderer.invoke("composer:skills:search", options ?? {}),
  saveRemoteAttachments: (attachments: RemoteAttachmentInput[]) =>
    ipcRenderer.invoke("attachment:remote", attachments),
  connect: () => ipcRenderer.invoke("codex:connect"),
  disconnect: () => ipcRenderer.invoke("codex:disconnect"),
  startThread: (options: {
    cwd: string;
    model?: string;
    serviceTier?: string | null;
    effort?: string | null;
    approvalPolicy?: string;
    approvalsReviewer?: string;
    permissionProfile?: string;
    sandbox?: string;
  }) =>
    ipcRenderer.invoke("codex:thread:start", options),
  listThreads: (options: { cwd: string }) =>
    ipcRenderer.invoke("codex:thread:list", options),
  listModels: (options?: { includeHidden?: boolean; limit?: number }) =>
    ipcRenderer.invoke("codex:model:list", options ?? {}),
  getStatus: () => ipcRenderer.invoke("codex:status"),
  renameThread: (options: { threadId: string; name: string }) =>
    ipcRenderer.invoke("codex:thread:rename", options),
  resumeThread: (options: {
    threadId: string;
    cwd: string;
    model?: string;
    serviceTier?: string | null;
    effort?: string | null;
    approvalPolicy?: string;
    approvalsReviewer?: string;
    permissionProfile?: string;
    sandbox?: string;
  }) =>
    ipcRenderer.invoke("codex:thread:resume", options),
  startTurn: (options: {
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
  }) =>
    ipcRenderer.invoke("codex:turn:start", options),
  interruptTurn: (options: { threadId: string; turnId: string }) =>
    ipcRenderer.invoke("codex:turn:interrupt", options),
  resolveApproval: (options: {
    requestId: string | number;
    decision: "accept" | "decline" | "cancel";
  }) => ipcRenderer.invoke("codex:approval:resolve", options),
  listPeriodicTasks: () => ipcRenderer.invoke("periodic-tasks:list"),
  createPeriodicTask: (input: PeriodicTaskInput) =>
    ipcRenderer.invoke("periodic-tasks:create", input),
  updatePeriodicTask: (options: { taskId: string; patch: Partial<PeriodicTaskInput> }) =>
    ipcRenderer.invoke("periodic-tasks:update", options),
  deletePeriodicTask: (options: { taskId: string }) =>
    ipcRenderer.invoke("periodic-tasks:delete", options),
  runPeriodicTaskNow: (options: { taskId: string }) =>
    ipcRenderer.invoke("periodic-tasks:run-now", options),
  onPeriodicTasksUpdated: (listener: (tasks: PeriodicTask[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PeriodicTask[]) => {
      listener(payload);
    };
    ipcRenderer.on("periodic-tasks:updated", handler);
    return () => ipcRenderer.off("periodic-tasks:updated", handler);
  },
  onEvent: (listener: (event: CodexAdapterEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: CodexAdapterEvent) => {
      listener(payload);
    };
    ipcRenderer.on("codex:event", handler);
    return () => ipcRenderer.off("codex:event", handler);
  }
});
