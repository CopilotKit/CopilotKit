"use client";

import {
  CopilotSidebar,
  CopilotKitProvider,
  useAgent,
} from "@copilotkit/react-core/v2";
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

export function AssistantShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selectedAgent, setSelectedAgent] = useState<
    "logistics" | "operations"
  >("logistics");
  const [autopilotMode, setAutopilotMode] = useState<
    "off" | "logistics" | "all"
  >("logistics");
  const activeThreadKey = threadStorageKey(user, selectedAgent);
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
      enabled: autopilotMode !== "off",
      agents: autopilotMode === "all" ? undefined : ["logistics"],
    }),
    [adapter, autopilotMode],
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
      agentId={selectedAgent}
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
                agentId={selectedAgent}
                storageKey={activeThreadKey}
              />
              <CopilotSidebar
                key={selectedAgent}
                agentId={selectedAgent}
                threadId={restoredThread.id ?? undefined}
                className="assistant-chat"
                defaultOpen
                width={480}
                header={{
                  title: "Assistant",
                  children: ({ titleContent, closeButton, drawerLauncher }) => (
                    <header
                      className="assistant-sidebar-header"
                      data-testid="copilot-modal-header"
                    >
                      <div className="assistant-sidebar-title">
                        {drawerLauncher}
                        {titleContent}
                        {closeButton}
                      </div>
                      <div className="assistant-settings">
                        <label>
                          Agent
                          <select
                            aria-label="Assistant agent"
                            value={selectedAgent}
                            onChange={(event) =>
                              setSelectedAgent(
                                event.target.value as
                                  | "logistics"
                                  | "operations",
                              )
                            }
                          >
                            <option value="logistics">Logistics</option>
                            <option value="operations">Operations</option>
                          </select>
                        </label>
                        <label>
                          Autopilot
                          <select
                            aria-label="Autopilot scope"
                            value={autopilotMode}
                            onChange={(event) =>
                              setAutopilotMode(
                                event.target.value as
                                  | "off"
                                  | "logistics"
                                  | "all",
                              )
                            }
                          >
                            <option value="off">Off</option>
                            <option value="logistics">Logistics only</option>
                            <option value="all">All agents</option>
                          </select>
                        </label>
                      </div>
                    </header>
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
