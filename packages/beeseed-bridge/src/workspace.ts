import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  ChannelEnsureWorkspaceMessage,
  CodexTurnStartMessage,
  JsonValue,
  SkillFileSpec,
  WorkspaceRecord,
  WorkspaceSpec
} from "./types.js";

export class WorkspaceManager {
  constructor(private readonly rootDir: string) {}

  async ensureFromMessage(
    message: ChannelEnsureWorkspaceMessage | CodexTurnStartMessage
  ): Promise<WorkspaceRecord> {
    const record = this.workspaceRecord(
      message.app_id,
      message.channel_id,
      message.agent_id
    );

    await mkdir(record.workspacePath, { recursive: true });
    await mkdir(record.codexHomePath, { recursive: true });
    await mkdir(path.join(record.workspacePath, ".beeseed"), { recursive: true });
    await mkdir(path.join(record.workspacePath, ".beeseed", "skills"), {
      recursive: true
    });
    await mkdir(path.join(record.workspacePath, ".beeseed", "mcp"), {
      recursive: true
    });
    await mkdir(path.join(record.workspacePath, "work"), { recursive: true });
    await mkdir(path.join(record.workspacePath, "artifacts"), { recursive: true });

    const spec = "workspace_spec" in message ? message.workspace_spec : undefined;
    await this.writeWorkspaceMetadata(record, message, spec);
    await this.writeAgentsMd(record, message, spec);
    await this.writeSkills(record, spec);
    await this.writeMcpConfig(record, spec?.mcp_config ?? null);
    await this.writeCodexConfig(record, spec?.mcp_config ?? null);

    return record;
  }

  workspaceRecord(appId: string, channelId: string, agentId: string): WorkspaceRecord {
    const appSegment = safeSegment(appId, "app");
    const channelSegment = safeSegment(channelId, "channel");
    const workspacePath = path.join(
      this.rootDir,
      "workspaces",
      appSegment,
      channelSegment
    );

    return {
      appId,
      channelId,
      agentId,
      workspacePath,
      codexHomePath: path.join(this.rootDir, "codex-home", channelSegment),
      sessionPath: path.join(workspacePath, ".beeseed", "session.json")
    };
  }

  async readSession(record: WorkspaceRecord): Promise<{ threadId?: string }> {
    if (!existsSync(record.sessionPath)) {
      return {};
    }

    try {
      const data = JSON.parse(await readFile(record.sessionPath, "utf8")) as {
        codex_thread_id?: unknown;
      };
      return typeof data.codex_thread_id === "string"
        ? { threadId: data.codex_thread_id }
        : {};
    } catch {
      return {};
    }
  }

  async writeSession(
    record: WorkspaceRecord,
    session: { threadId: string }
  ): Promise<void> {
    await writeJson(record.sessionPath, {
      app_id: record.appId,
      channel_id: record.channelId,
      agent_id: record.agentId,
      codex_thread_id: session.threadId,
      updated_at: new Date().toISOString()
    });
  }

  private async writeWorkspaceMetadata(
    record: WorkspaceRecord,
    message: ChannelEnsureWorkspaceMessage | CodexTurnStartMessage,
    spec: WorkspaceSpec | undefined
  ): Promise<void> {
    await writeJson(path.join(record.workspacePath, ".beeseed", "channel.json"), {
      app_id: record.appId,
      channel_id: record.channelId,
      title: spec?.title ?? "",
      updated_at: new Date().toISOString()
    });

    await writeJson(path.join(record.workspacePath, ".beeseed", "agent.json"), {
      agent_id: record.agentId,
      source_message_type: message.type,
      updated_at: new Date().toISOString()
    });
  }

  private async writeAgentsMd(
    record: WorkspaceRecord,
    message: ChannelEnsureWorkspaceMessage | CodexTurnStartMessage,
    spec: WorkspaceSpec | undefined
  ): Promise<void> {
    const content = spec?.agents_md?.trim()
      ? spec.agents_md
      : defaultAgentsMd(record, spec);
    await writeFile(path.join(record.workspacePath, "AGENTS.md"), ensureTrailingNewline(content));

    const readme = [
      "# BeeSeed Codex Bridge Workspace",
      "",
      `App: ${record.appId}`,
      `Channel: ${record.channelId}`,
      `Agent: ${record.agentId}`,
      "",
      "This directory is managed by BeeSeed Codex Bridge. Put working files under `work/` and generated artifacts under `artifacts/`.",
      "",
      `Last updated from ${message.type} at ${new Date().toISOString()}.`
    ].join("\n");
    await writeFile(path.join(record.workspacePath, "README.md"), `${readme}\n`);
  }

  private async writeSkills(
    record: WorkspaceRecord,
    spec: WorkspaceSpec | undefined
  ): Promise<void> {
    for (const skill of spec?.skills ?? []) {
      const skillDir = path.join(
        record.workspacePath,
        ".beeseed",
        "skills",
        safeSegment(skill.id, "skill")
      );
      await mkdir(skillDir, { recursive: true });

      for (const file of skill.files) {
        await this.writeSkillFile(skillDir, file);
      }
    }
  }

  private async writeSkillFile(skillDir: string, file: SkillFileSpec): Promise<void> {
    const relativePath = safeRelativePath(file.path);
    const target = path.join(skillDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, ensureTrailingNewline(file.content));
  }

  private async writeMcpConfig(
    record: WorkspaceRecord,
    mcpConfig: JsonValue
  ): Promise<void> {
    await writeJson(path.join(record.workspacePath, ".beeseed", "mcp", "config.json"), {
      mcp_config: mcpConfig ?? null,
      updated_at: new Date().toISOString()
    });
  }

  private async writeCodexConfig(
    record: WorkspaceRecord,
    mcpConfig: JsonValue
  ): Promise<void> {
    const lines = [
      "# Generated by BeeSeed Codex Bridge.",
      "# This per-channel CODEX_HOME avoids changing the user's global Codex config.",
      "",
      `beeseed_workspace = ${tomlString(record.workspacePath)}`,
      ""
    ];

    if (mcpConfig && typeof mcpConfig === "object" && !Array.isArray(mcpConfig)) {
      lines.push(
        "# Raw MCP config is stored at:",
        `beeseed_mcp_config = ${tomlString(
          path.join(record.workspacePath, ".beeseed", "mcp", "config.json")
        )}`,
        ""
      );
    }

    await writeFile(path.join(record.codexHomePath, "config.toml"), lines.join("\n"));
  }
}

function defaultAgentsMd(record: WorkspaceRecord, spec: WorkspaceSpec | undefined): string {
  const skillLines = (spec?.skills ?? []).map(
    skill => `- ${skill.id}${skill.version ? `@${skill.version}` : ""}: .beeseed/skills/${safeSegment(skill.id, "skill")}/SKILL.md`
  );

  return [
    "# AGENTS.md",
    "",
    "You are Codex running inside a BeeSeed channel workspace.",
    "",
    "## BeeSeed Context",
    "",
    `- App ID: ${record.appId}`,
    `- Channel ID: ${record.channelId}`,
    `- Agent ID: ${record.agentId}`,
    "",
    "## Workspace Rules",
    "",
    "- Use `work/` for working files.",
    "- Use `artifacts/` for generated files that should be shared back to BeeSeed.",
    "- Keep responses concise and suitable for a BeeSeed channel conversation.",
    "- This run may be started remotely from BeeSeed. Treat Full Access as powerful and act only on the user's latest request.",
    "",
    "## Skills",
    "",
    skillLines.length > 0 ? skillLines.join("\n") : "No BeeSeed skills are configured for this channel.",
    ""
  ].join("\n");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function safeSegment(input: string, prefix: string): string {
  const clean = input.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (clean) {
    return `${prefix}-${clean}`;
  }
  return `${prefix}-${Buffer.from(input).toString("base64url")}`;
}

function safeRelativePath(input: string): string {
  const clean = path.posix.normalize(input.replace(/\\/g, "/"));
  if (clean === "." || clean.startsWith("../") || clean === ".." || path.posix.isAbsolute(clean)) {
    throw new Error(`Unsafe skill file path: ${input}`);
  }
  return clean;
}

function ensureTrailingNewline(input: string): string {
  return input.endsWith("\n") ? input : `${input}\n`;
}

function tomlString(input: string): string {
  return JSON.stringify(input);
}
