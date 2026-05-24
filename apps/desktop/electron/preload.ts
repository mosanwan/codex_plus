import { contextBridge, ipcRenderer } from "electron";
import type { CodexAdapterEvent, UserInput } from "@codep/codex-adapter";

contextBridge.exposeInMainWorld("codexApp", {
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  readClipboardAttachments: () => ipcRenderer.invoke("attachment:clipboard"),
  connect: () => ipcRenderer.invoke("codex:connect"),
  disconnect: () => ipcRenderer.invoke("codex:disconnect"),
  startThread: (options: { cwd: string }) =>
    ipcRenderer.invoke("codex:thread:start", options),
  listThreads: (options: { cwd: string }) =>
    ipcRenderer.invoke("codex:thread:list", options),
  resumeThread: (options: { threadId: string; cwd: string }) =>
    ipcRenderer.invoke("codex:thread:resume", options),
  startTurn: (options: { threadId: string; text: string; input?: UserInput[] }) =>
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
