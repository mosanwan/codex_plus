import type { CodexNotification, CodexServerRequest, RequestId } from "./types.js";

export type CodexAdapterEvent =
  | {
      type: "thread.started";
      threadId: string;
      thread: unknown;
      raw: CodexNotification;
    }
  | {
      type: "turn.started";
      threadId: string;
      turnId: string;
      turn: unknown;
      raw: CodexNotification;
    }
  | {
      type: "message.delta";
      threadId: string;
      turnId: string;
      itemId: string;
      text: string;
      raw: CodexNotification;
    }
  | {
      type: "reasoning.delta";
      threadId: string;
      turnId: string;
      itemId: string | null;
      text: string;
      raw: CodexNotification;
    }
  | {
      type: "command.delta";
      threadId: string;
      turnId: string;
      itemId: string | null;
      stream: "stdout" | "stderr" | "unknown";
      text: string;
      raw: CodexNotification;
    }
  | {
      type: "file.patch.updated";
      threadId: string;
      turnId: string;
      itemId: string;
      patch: unknown;
      raw: CodexNotification;
    }
  | {
      type: "diff.updated";
      threadId: string;
      turnId: string;
      diff: unknown;
      raw: CodexNotification;
    }
  | {
      type: "plan.updated";
      threadId: string;
      turnId: string;
      plan: unknown;
      raw: CodexNotification;
    }
  | {
      type: "turn.completed";
      threadId: string;
      turnId: string;
      turn: unknown;
      raw: CodexNotification;
    }
  | {
      type: "approval.requested";
      requestId: RequestId;
      approvalType: "command" | "fileChange" | "permissions" | "toolUserInput" | "unknown";
      threadId: string | null;
      turnId: string | null;
      itemId: string | null;
      request: unknown;
      raw: CodexServerRequest;
    }
  | {
      type: "raw.notification";
      method: string;
      raw: CodexNotification;
    }
  | {
      type: "raw.serverRequest";
      method: string;
      requestId: RequestId;
      raw: CodexServerRequest;
    };

export function normalizeNotification(
  notification: CodexNotification
): CodexAdapterEvent {
  const params = asRecord(notification.params);

  switch (notification.method) {
    case "thread/started": {
      const thread = asRecord(params.thread);
      return {
        type: "thread.started",
        threadId: stringValue(thread.id),
        thread: params.thread,
        raw: notification
      };
    }

    case "turn/started": {
      const turn = asRecord(params.turn);
      return {
        type: "turn.started",
        threadId: stringValue(params.threadId),
        turnId: stringValue(turn.id),
        turn: params.turn,
        raw: notification
      };
    }

    case "item/agentMessage/delta":
      return {
        type: "message.delta",
        threadId: stringValue(params.threadId),
        turnId: stringValue(params.turnId),
        itemId: stringValue(params.itemId),
        text: stringValue(params.delta),
        raw: notification
      };

    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return {
        type: "reasoning.delta",
        threadId: stringValue(params.threadId),
        turnId: stringValue(params.turnId),
        itemId: nullableString(params.itemId),
        text: stringValue(params.delta),
        raw: notification
      };

    case "item/commandExecution/outputDelta":
    case "command/exec/outputDelta":
    case "process/outputDelta":
      return {
        type: "command.delta",
        threadId: stringValue(params.threadId),
        turnId: stringValue(params.turnId),
        itemId: nullableString(
          params.itemId ?? params.commandId ?? params.processId ?? params.processHandle
        ),
        stream: streamValue(params.stream),
        text: outputText(params),
        raw: notification
      };

    case "item/fileChange/patchUpdated":
      return {
        type: "file.patch.updated",
        threadId: stringValue(params.threadId),
        turnId: stringValue(params.turnId),
        itemId: stringValue(params.itemId),
        patch: params.patch ?? params,
        raw: notification
      };

    case "turn/diff/updated":
      return {
        type: "diff.updated",
        threadId: stringValue(params.threadId),
        turnId: stringValue(params.turnId),
        diff: params.diff ?? params,
        raw: notification
      };

    case "turn/plan/updated":
      return {
        type: "plan.updated",
        threadId: stringValue(params.threadId),
        turnId: stringValue(params.turnId),
        plan: params.plan ?? params,
        raw: notification
      };

    case "turn/completed": {
      const turn = asRecord(params.turn);
      return {
        type: "turn.completed",
        threadId: stringValue(params.threadId),
        turnId: stringValue(turn.id),
        turn: params.turn,
        raw: notification
      };
    }

    default:
      return {
        type: "raw.notification",
        method: notification.method,
        raw: notification
      };
  }
}

export function normalizeServerRequest(
  request: CodexServerRequest
): CodexAdapterEvent {
  const params = asRecord(request.params);
  const approvalType = approvalTypeForMethod(request.method);

  if (approvalType !== "unknown") {
    return {
      type: "approval.requested",
      requestId: request.id,
      approvalType,
      threadId: nullableString(params.threadId),
      turnId: nullableString(params.turnId),
      itemId: nullableString(params.itemId),
      request: request.params,
      raw: request
    };
  }

  return {
    type: "raw.serverRequest",
    method: request.method,
    requestId: request.id,
    raw: request
  };
}

function approvalTypeForMethod(
  method: string
): "command" | "fileChange" | "permissions" | "toolUserInput" | "unknown" {
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "execCommandApproval":
      return "command";
    case "item/fileChange/requestApproval":
    case "applyPatchApproval":
      return "fileChange";
    case "item/permissions/requestApproval":
      return "permissions";
    case "item/tool/requestUserInput":
      return "toolUserInput";
    default:
      return "unknown";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function streamValue(value: unknown): "stdout" | "stderr" | "unknown" {
  return value === "stdout" || value === "stderr" ? value : "unknown";
}

function outputText(params: Record<string, unknown>): string {
  const direct = params.delta ?? params.text;
  if (typeof direct === "string") {
    return direct;
  }

  if (typeof params.deltaBase64 === "string") {
    return Buffer.from(params.deltaBase64, "base64").toString("utf8");
  }

  return "";
}
