export type ViewMode = "sessions" | "chat" | "settings";
export type ConnectionState = "online" | "pairing" | "offline";
export type PermissionMode = "default" | "auto-review" | "full-access";
export type ModelEffort = "low" | "medium" | "high" | "xhigh";

export interface Device {
  id: string;
  name: string;
  workspace: string;
  connection: ConnectionState;
  lastSeen: string;
}

export interface Session {
  id: string;
  title: string;
  updatedAt: string;
  status: "ready" | "working" | "approval";
}

export interface Workspace {
  path: string;
  name: string;
  sessions: Session[];
}

export interface Message {
  id: string;
  role: "user" | "codex" | "event";
  text: string;
  meta?: string;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  kind: "image";
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface Approval {
  id: string;
  title: string;
  detail: string;
  risk: "medium" | "high";
}

export interface RemoteSnapshot {
  device: Device;
  workspaces: Workspace[];
  activeWorkspace: string | null;
  sessions: Session[];
  activeSessionId: string;
  messages: Message[];
  approvals: Approval[];
  diffLines: string[];
  permissionMode: PermissionMode;
  model: string;
  modelEffort: ModelEffort;
  contextUsage: {
    usedTokens: number;
    contextWindow: number | null;
  } | null;
}

export interface RemoteClient {
  readSnapshot(): Promise<RemoteSnapshot>;
  sendMessage(sessionId: string, text: string): Promise<Message>;
  interruptTurn(sessionId: string): Promise<void>;
  resolveApproval(approvalId: string, decision: "approve" | "decline"): Promise<void>;
}

export const mockSnapshot: RemoteSnapshot = {
  device: {
    id: "desktop-main",
    name: "three workstation",
    workspace: "/home/three/workspace/codep",
    connection: "online",
    lastSeen: "Now"
  },
  workspaces: [
    {
      path: "/home/three/workspace/codep",
      name: "codep",
      sessions: [
        {
          id: "019e54af",
          title: "Android App 版开发",
          updatedAt: "02:30",
          status: "working"
        },
        {
          id: "019e49fe",
          title: "fal_generate 支持模型",
          updatedAt: "Yesterday",
          status: "ready"
        }
      ]
    },
    {
      path: "/home/three/workspace/test_codexp",
      name: "test_codexp",
      sessions: [
        {
          id: "019e44b1",
          title: "远程控制方案",
          updatedAt: "May 21",
          status: "approval"
        }
      ]
    }
  ],
  activeWorkspace: "/home/three/workspace/codep",
  sessions: [
    {
      id: "019e54af",
      title: "Android App 版开发",
      updatedAt: "02:30",
      status: "working"
    },
    {
      id: "019e49fe",
      title: "fal_generate 支持模型",
      updatedAt: "Yesterday",
      status: "ready"
    },
    {
      id: "019e44b1",
      title: "远程控制方案",
      updatedAt: "May 21",
      status: "approval"
    }
  ],
  activeSessionId: "019e54af",
  messages: [
    {
      id: "m1",
      role: "event",
      text: "Connected to desktop through relay preview",
      meta: "remote gateway"
    },
    {
      id: "m2",
      role: "user",
      text: "接下来开发 Android App 版的"
    },
    {
      id: "m3",
      role: "codex",
      text:
        "我会先做一个移动端远程控制 UI 壳，使用 React + Vite + Capacitor，后续接 Relay 后可以直接复用这个入口。"
    },
    {
      id: "m4",
      role: "event",
      text: "Ran npm install\nAdded Capacitor Android dependencies",
      meta: "command"
    }
  ],
  approvals: [
    {
      id: "a1",
      title: "Run Android sync",
      detail: "npx capacitor sync android",
      risk: "medium"
    },
    {
      id: "a2",
      title: "Open Android Studio",
      detail: "Launch local Android project from desktop",
      risk: "high"
    }
  ],
  diffLines: [
    "diff --git a/apps/mobile/src/App.tsx b/apps/mobile/src/App.tsx",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/apps/mobile/src/App.tsx",
    "@@ -0,0 +1,8 @@",
    "+import { Send } from \"lucide-react\";",
    "+export function App() {",
    "+  return <main>CodeP Mobile</main>;",
    "+}",
    "-// mobile shell pending"
  ],
  permissionMode: "default",
  model: "gpt-5.5",
  modelEffort: "high",
  contextUsage: {
    usedTokens: 38912,
    contextWindow: 256000
  }
};
