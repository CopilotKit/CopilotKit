"use client";

import {
  CopilotChatConfigurationProvider,
  CopilotKit,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { catalog } from "@/a2ui/catalog";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ToolRenderers } from "@/components/chat/tool-renderers";
import { AGENT_ID } from "@/lib/agent-id";
import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";
import type { DemoUser } from "@/lib/user";
import type { RepoCardData } from "@/lib/example-repos";
import { WorkspaceProvider } from "@/lib/use-workspace";
import { ConversationsDrawer } from "./conversations-drawer";
import { Header } from "./header";
import { ThreadList } from "./thread-list";
import { WorkspacePanel } from "./workspace-panel";

const A2UI = { catalog };

interface ShellProps {
  threadsEnabled: boolean;
  initialUser: DemoUser | null;
  repos: RepoCardData[];
}

export function AppShell(props: ShellProps) {
  return (
    // REST transport so thread routes and runs share one multi-route endpoint.
    // enableInspector shows the CopilotKit Inspector (the kite button) in
    // development, for watching AG-UI events, agent state and messages live.
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      a2ui={A2UI}
      enableInspector={process.env.NODE_ENV === "development"}
    >
      {/* Owns the active thread, so the header and thread list can switch it. */}
      <CopilotChatConfigurationProvider agentId={AGENT_ID}>
        <WorkspaceProvider>
          <ToolRenderers />
          <Layout {...props} />
        </WorkspaceProvider>
      </CopilotChatConfigurationProvider>
    </CopilotKit>
  );
}

function Layout({ threadsEnabled, initialUser, repos }: ShellProps) {
  const chat = useCopilotChatConfiguration();
  const [user, setUser] = useState(initialUser);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden">
      <Header
        user={user}
        onUserChange={(next) => {
          // A different person: start clean; the thread list remounts for them.
          setUser(next);
          chat?.startNewThread();
        }}
        onNewThread={() => chat?.startNewThread()}
        onOpenConversations={
          threadsEnabled ? () => setDrawerOpen(true) : undefined
        }
        showNewThread={!threadsEnabled}
      />
      {threadsEnabled && (
        <ConversationsDrawer open={drawerOpen} onClose={closeDrawer}>
          <ThreadList
            key={user?.id ?? "anonymous"}
            activeThreadId={chat?.threadId ?? ""}
            onSelect={(threadId) => {
              chat?.setActiveThreadId(threadId);
              closeDrawer();
            }}
            onNewThread={() => {
              chat?.startNewThread();
              closeDrawer();
            }}
          />
        </ConversationsDrawer>
      )}
      <div
        className={cn(
          "grid min-h-0 flex-1",
          threadsEnabled
            ? "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[272px_minmax(0,1fr)_340px]"
            : "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]",
        )}
      >
        {threadsEnabled && (
          <div className="hidden min-h-0 xl:flex xl:flex-col">
            <ThreadList
              key={user?.id ?? "anonymous"}
              activeThreadId={chat?.threadId ?? ""}
              onSelect={(threadId) => chat?.setActiveThreadId(threadId)}
              onNewThread={() => chat?.startNewThread()}
            />
          </div>
        )}
        <ChatPanel repos={repos} />
        <div className="hidden min-h-0 lg:flex lg:flex-col">
          <WorkspacePanel />
        </div>
      </div>
    </div>
  );
}
