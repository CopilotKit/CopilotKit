"use client";

import { WebSocketAgent } from "@copilotkitnext/core";
import { CopilotChat, CopilotKitProvider } from "@copilotkitnext/react";
import { useMemo, useState } from "react";

const REST_URL =
  process.env.NEXT_PUBLIC_BFF_REST_URL ??
  "http://localhost:4100/api/copilotkit";
const WS_URL =
  process.env.NEXT_PUBLIC_GATEWAY_WS_URL ??
  "ws://localhost:4200/ws/websocket";

export const dynamic = "force-dynamic";

export default function Page() {
  const [threadId, setThreadId] = useState("thread-a");

  const agent = useMemo(
    () =>
      new WebSocketAgent({
        restUrl: REST_URL,
        wsUrl: WS_URL,
        agentId: "default",
      }),
    [],
  );

  return (
    <CopilotKitProvider
      runtimeUrl={REST_URL}
      agents__unsafe_dev_only={{ default: agent }}
      showDevConsole="auto"
    >
      <main>
        <section
          style={{
            maxWidth: 920,
            margin: "0 auto",
            background: "var(--card)",
            borderRadius: 16,
            border: "1px solid rgba(0, 0, 0, 0.08)",
            boxShadow: "0 16px 40px rgba(0, 0, 0, 0.08)",
            padding: 20,
          }}
        >
          <h1 style={{ marginTop: 0 }}>Realtime Threads PoC</h1>
          <p style={{ marginTop: 0, opacity: 0.75 }}>
            Open this page in two tabs on the same thread to see multicast. Start concurrent runs
            on the same thread to trigger lock conflicts (`409 thread_locked`).
          </p>
          <label htmlFor="thread" style={{ display: "block", fontWeight: 600 }}>
            Thread ID
          </label>
          <input
            id="thread"
            value={threadId}
            onChange={(event) => setThreadId(event.target.value)}
            style={{
              width: "100%",
              marginTop: 8,
              marginBottom: 14,
              borderRadius: 10,
              border: "1px solid #c8d1ea",
              padding: "10px 12px",
              fontSize: 14,
            }}
          />
          <div style={{ minHeight: 600 }}>
            <CopilotChat threadId={threadId} />
          </div>
        </section>
      </main>
    </CopilotKitProvider>
  );
}
