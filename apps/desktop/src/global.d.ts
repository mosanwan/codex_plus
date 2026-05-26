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

export interface NotificationSoundFile {
  path: string;
  url: string;
  name: string;
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
      searchWorkspaceFiles(options: {
        cwd: string;
        query?: string;
        limit?: number;
      }): Promise<ComposerSuggestion[]>;
      searchSkills(options?: {
        query?: string;
        limit?: number;
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
      onEvent(listener: (event: CodexAdapterEvent) => void): () => void;
    };
  }
}

export {};
