import { EventEmitter } from "node:events";
import type {
  CodexNotification,
  CodexServerRequest,
  JsonRpcError,
  JsonRpcMessage,
  JsonRpcRequest,
  RequestId
} from "./types.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface JsonRpcClientEvents {
  notification: [CodexNotification];
  serverRequest: [CodexServerRequest];
  close: [];
  error: [Error];
}

export class JsonRpcClient {
  private readonly emitter = new EventEmitter();
  private readonly pending = new Map<RequestId, PendingRequest>();
  private nextId = 1;
  private socket: WebSocket | null = null;
  private isClosing = false;

  constructor(
    private readonly url: string,
    private readonly requestTimeoutMs = 30_000
  ) {}

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }

    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.isClosing = false;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Failed to connect to ${this.url}`));
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });

    socket.addEventListener("message", event => {
      void this.handleMessage(event.data);
    });
    socket.addEventListener("close", () => {
      this.rejectAll(new Error("Codex app-server WebSocket closed"));
      this.socket = null;
      this.emitter.emit("close");
    });
    socket.addEventListener("error", () => {
      if (!this.isClosing) {
        this.emitter.emit("error", new Error("Codex app-server WebSocket error"));
      }
    });
  }

  close(): void {
    this.isClosing = true;
    this.socket?.close();
    this.socket = null;
    this.rejectAll(new Error("Codex JSON-RPC client closed"));
  }

  on<K extends keyof JsonRpcClientEvents>(
    event: K,
    listener: (...args: JsonRpcClientEvents[K]) => void
  ): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const message: JsonRpcRequest = { id, method };
    if (params !== undefined) {
      message.params = params;
    }

    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for JSON-RPC response to ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timeout
      });
    });

    this.send(message);
    return promise;
  }

  notify(method: string, params?: unknown): void {
    const message: { method: string; params?: unknown } = { method };
    if (params !== undefined) {
      message.params = params;
    }
    this.send(message);
  }

  respond<T>(id: RequestId, result: T): void {
    this.send({ id, result });
  }

  respondError(id: RequestId, code: number, message: string, data?: unknown): void {
    this.send({ id, error: { code, message, data } });
  }

  private send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server WebSocket is not open");
    }
    this.socket.send(JSON.stringify(message));
  }

  private async handleMessage(data: unknown): Promise<void> {
    try {
      const text = await messageDataToText(data);
      const message = JSON.parse(text) as JsonRpcMessage;

      if ("id" in message && "method" in message) {
        this.emitter.emit("serverRequest", {
          id: message.id,
          method: message.method,
          params: message.params
        });
        return;
      }

      if ("id" in message && ("result" in message || "error" in message)) {
        this.handleResponse(message);
        return;
      }

      if ("method" in message) {
        this.emitter.emit("notification", {
          method: message.method,
          params: message.params
        });
      }
    } catch (error) {
      this.emitter.emit(
        "error",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private handleResponse(message: JsonRpcMessage): void {
    if (!("id" in message)) {
      return;
    }

    if (message.id === null) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);

    if ("error" in message) {
      pending.reject(jsonRpcErrorToError(message));
      return;
    }

    if ("result" in message) {
      pending.resolve(message.result);
    }
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function messageDataToText(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8"
    );
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return String(data);
}

function jsonRpcErrorToError(message: JsonRpcError): Error {
  const error = new Error(message.error.message);
  Object.assign(error, {
    code: message.error.code,
    data: message.error.data,
    requestId: message.id
  });
  return error;
}
