import process from "node:process";
import { CodexAdapter } from "./client.js";

async function main(): Promise<void> {
  const turnText = readTurnArg();
  const adapter = new CodexAdapter({
    clientInfo: {
      name: "codep-adapter-probe",
      title: "CodeP Adapter Probe",
      version: "0.1.0"
    }
  });

  adapter.on("notification", notification => {
    if (
      notification.method === "item/agentMessage/delta" ||
      notification.method === "turn/completed" ||
      notification.method === "turn/started" ||
      notification.method === "thread/started"
    ) {
      console.log("[notification]", JSON.stringify(notification));
    }
  });

  adapter.on("event", event => {
    if (
      event.type === "message.delta" ||
      event.type === "turn.started" ||
      event.type === "turn.completed" ||
      event.type === "approval.requested"
    ) {
      console.log("[event]", JSON.stringify(event));
    }
  });

  adapter.on("serverRequest", request => {
    console.log("[server-request]", JSON.stringify(request));
    adapter.resolveServerRequest(request.id, { decision: "decline" });
  });

  adapter.on("error", error => {
    console.error("[adapter-error]", error.message);
  });

  try {
    const initialized = await adapter.connect();
    console.log("[initialize]", initialized.userAgent);
    console.log("[codex-home]", initialized.codexHome);

    const threadResponse = await adapter.startThread({
      cwd: process.cwd(),
      ephemeral: true
    });
    console.log("[thread]", threadResponse.thread.id);
    console.log("[model]", threadResponse.modelProvider, threadResponse.model);

    if (turnText) {
      const turnResponse = await adapter.startTurn(
        threadResponse.thread.id,
        turnText
      );
      console.log("[turn]", turnResponse.turn.id);
      await waitForTurnCompleted(adapter, turnResponse.turn.id);
    }
  } finally {
    await adapter.disconnect();
  }
}

function readTurnArg(): string | null {
  const index = process.argv.indexOf("--turn");
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value) {
    throw new Error("Missing value after --turn");
  }
  return value;
}

async function waitForTurnCompleted(
  adapter: CodexAdapter,
  turnId: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for turn ${turnId} to complete`));
    }, 120_000);

    const unsubscribe = adapter.on("notification", notification => {
      if (notification.method !== "turn/completed") {
        return;
      }

      const params = notification.params as { turn?: { id?: string } } | undefined;
      if (params?.turn?.id !== turnId) {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

await main();
