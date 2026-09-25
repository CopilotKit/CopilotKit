"use client";

import {
  CopilotSidebar,
  CopilotKitProvider,
  useAgent,
} from "@copilotkit/react-core/v2";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/db";
import { createAutopilotAdapter } from "@/lib/autopilot";

function threadStorageKey(user: SessionUser, agentId: string): string {
  return `northstar:copilotkit:thread:${user.organizationId}:${user.id}:${agentId}`;
}

function RememberThread({
  agentId,
  storageKey,
}: {
  agentId: string;
  storageKey: string;
}) {
  const { agent } = useAgent({ agentId });
  useEffect(() => {
    if (
      agent.threadId &&
      agent.messages.some((message) => message.role === "user")
    )
      sessionStorage.setItem(storageKey, agent.threadId);
  }, [agent.threadId, agent.messages, storageKey]);
  return null;
}

function NewThreadButton({ onNewThread }: { onNewThread(): void }) {
  const { agent } = useAgent({ agentId: "logistics" });
  const { copilotkit } = useCopilotKit();
  return (
    <button
      type="button"
      className="assistant-new-thread"
      aria-label="New thread"
      title="New thread"
      onClick={() => {
        copilotkit.stopAgent({ agent });
        agent.setMessages([]);
        agent.setState({});
        onNewThread();
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="m16 3 5 5M10 14l4-1L22 5a2.12 2.12 0 0 0-3-3l-8 8-1 4Z" />
      </svg>
    </button>
  );
}

export function AssistantShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [threadGeneration, setThreadGeneration] = useState(0);
  const activeThreadKey = threadStorageKey(user, "logistics");
  const [restoredThread, setRestoredThread] = useState<{
    key: string;
    id: string | null;
  } | null>(null);
  useEffect(() => {
    setRestoredThread({
      key: activeThreadKey,
      id: sessionStorage.getItem(activeThreadKey),
    });
  }, [activeThreadKey]);
  const adapter = useMemo(
    () => createAutopilotAdapter(user, router),
    [user, router],
  );
  useEffect(() => {
    const guard = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
        ".app-shell a[href]",
      );
      if (
        link &&
        new URL(link.href).pathname !== window.location.pathname &&
        !adapter.navigation.mayLeave()
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [adapter]);
  const autopilot = useMemo(
    () => ({
      adapter,
      enabled: true,
      agents: ["logistics"],
    }),
    [adapter],
  );
  async function signOut() {
    const response = await fetch("/api/session", { method: "DELETE" });
    if (response.ok) {
      sessionStorage.removeItem(threadStorageKey(user, "logistics"));
      sessionStorage.removeItem(threadStorageKey(user, "operations"));
      setRestoredThread(null);
      router.push("/sign-in");
      router.refresh();
    }
  }

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId="logistics"
      autopilot={autopilot}
      enableInspector
    >
      <div className="app-shell" data-copilot-page>
        <aside className="navigation">
          <div className="brand">
            <span className="brand-mark">N</span>
            <span>
              Northstar
              <br />
              <small>LOGISTICS</small>
            </span>
          </div>
          <nav aria-label="Primary navigation">
            <Link href="/">Dashboard</Link>
            <Link href="/orders">Orders</Link>
            <Link href="/users">Users</Link>
          </nav>
          <div className="account" data-copilot-private>
            <strong>{user.displayName}</strong>
            <span>
              {user.role} · {user.organizationName}
            </span>
            <button onClick={signOut}>Sign out</button>
          </div>
        </aside>
        <div className="workspace">
          <main>{children}</main>
        </div>
        <div className="assistant-panel">
          {restoredThread?.key === activeThreadKey && (
            <>
              <RememberThread
                agentId="logistics"
                storageKey={activeThreadKey}
              />
              <CopilotSidebar
                key={threadGeneration}
                agentId="logistics"
                threadId={restoredThread.id ?? undefined}
                className="assistant-chat"
                defaultOpen
                width={480}
                header={{
                  children: () => (
                    <NewThreadButton
                      onNewThread={() => {
                        sessionStorage.removeItem(activeThreadKey);
                        setRestoredThread({ key: activeThreadKey, id: null });
                        setThreadGeneration((generation) => generation + 1);
                      }}
                    />
                  ),
                }}
                showAutopilotActivity
                labels={{
                  chatInputPlaceholder:
                    "Ask about orders, shipments, or users…",
                }}
              />
            </>
          )}
        </div>
      </div>
    </CopilotKitProvider>
  );
}
