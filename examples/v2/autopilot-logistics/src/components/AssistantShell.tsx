"use client";

import {
  CopilotChat,
  CopilotKitProvider,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { SessionUser } from "@/lib/db";

function BrowserProbe() {
  useFrontendTool({
    name: "describeVisiblePage",
    description:
      "Read the current Northstar Logistics screen from the user's browser. Use this before answering questions about what is currently visible.",
    parameters: z.object({}),
    handler: async () => ({
      title: document.querySelector("main h1")?.textContent ?? "Unknown screen",
      path: window.location.pathname,
      heading: document.querySelector("main h2")?.textContent ?? null,
    }),
  });
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
  async function signOut() {
    const response = await fetch("/api/session", { method: "DELETE" });
    if (response.ok) {
      router.push("/sign-in");
      router.refresh();
    }
  }

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId="logistics"
      enableInspector
    >
      <BrowserProbe />
      <div className="app-shell">
        <aside className="navigation" data-copilot-private>
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
          <div className="account">
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
        <aside className="assistant-panel" data-copilot-private>
          <div className="assistant-heading">
            <span>Assistant</span>
            <small>Northstar workspace</small>
          </div>
          <CopilotChat
            agentId="logistics"
            className="assistant-chat"
            labels={{
              chatInputPlaceholder: "Ask about orders, shipments, or users…",
            }}
          />
        </aside>
      </div>
    </CopilotKitProvider>
  );
}
