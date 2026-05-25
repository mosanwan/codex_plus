import { contextBridge, ipcRenderer } from "electron";
import type { CodexAdapterEvent, UserInput } from "@codep/codex-adapter";

interface RemoteAttachmentInput {
  kind: "image";
  name: string;
  mimeType: string;
  dataUrl: string;
}

contextBridge.exposeInMainWorld("codexApp", {
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  readClipboardAttachments: () => ipcRenderer.invoke("attachment:clipboard"),
  chooseAttachmentFiles: () => ipcRenderer.invoke("attachment:choose"),
  chooseNotificationSoundFile: () => ipcRenderer.invoke("notification:sound:choose"),
  searchWorkspaceFiles: (options: { cwd: string; query?: string; limit?: number }) =>
    ipcRenderer.invoke("composer:files:search", options),
  searchSkills: (options?: { query?: string; limit?: number }) =>
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
  }) =>
    ipcRenderer.invoke("codex:turn:start", options),
  interruptTurn: (options: { threadId: string; turnId: string }) =>
    ipcRenderer.invoke("codex:turn:interrupt", options),
  resolveApproval: (options: {
    requestId: string | number;
    decision: "accept" | "decline" | "cancel";
  }) => ipcRenderer.invoke("codex:approval:resolve", options),
  onEvent: (listener: (event: CodexAdapterEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: CodexAdapterEvent) => {
      listener(payload);
    };
    ipcRenderer.on("codex:event", handler);
    return () => ipcRenderer.off("codex:event", handler);
  }
});
