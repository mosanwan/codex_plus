import type {
  CodexAdapterEvent,
  ThreadListResponse,
  ThreadStartResponse,
  TurnStartResponse,
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
      startThread(options: { cwd: string }): Promise<ThreadStartResponse>;
      listThreads(options: { cwd: string }): Promise<ThreadListResponse>;
      resumeThread(options: {
        threadId: string;
        cwd: string;
      }): Promise<ThreadStartResponse>;
      startTurn(options: {
        threadId: string;
        text: string;
        input?: UserInput[];
      }): Promise<TurnStartResponse>;
      interruptTurn(options: {
        threadId: string;
        turnId: string;
      }): Promise<unknown>;
      resolveApproval(options: {
        requestId: string | number;
        decision: "accept" | "decline" | "cancel";
      }): Promise<void>;
      onEvent(listener: (event: CodexAdapterEvent) => void): () => void;
    };
  }
}

export {};
