"use client";

import { CopilotKit, useCopilotKit } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { DemoAgentId } from "./agents";

type Session = { threadId: string; token: string };
type SessionState =
  | { status: "loading" | "ended" | "unavailable" }
  | { status: "ready"; session: Session };

const runtimeUrl = "/api/copilotkit";

function requestSession(
  agent: DemoAgentId,
  token: string | null,
  signal?: AbortSignal,
) {
  return fetch(`${runtimeUrl}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ agentId: agent }),
    signal,
  });
}

function SessionExpiryObserver({
  agent,
  token,
  onExpiry,
}: {
  agent: DemoAgentId;
  token: string;
  onExpiry: () => void;
}) {
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    const controller = new AbortController();
    const subscription = copilotkit.subscribe({
      onError({ code, context }) {
        if (context?.runtimeStatus === 401) {
          onExpiry();
        } else if (code === "agent_run_failed") {
          // A restarted runtime also rejects turns in an already open chat.
          void requestSession(agent, token, controller.signal)
            .then((response) => {
              if (!controller.signal.aborted && response.status === 401) {
                onExpiry();
              }
            })
            .catch(() => {});
        }
      },
    });

    return () => {
      controller.abort();
      subscription.unsubscribe();
    };
  }, [agent, copilotkit, onExpiry, token]);

  return null;
}

export function DemoSessionProvider({
  agent,
  children,
}: {
  agent: DemoAgentId;
  children: ReactNode;
}) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const { status } = state;

  useEffect(() => {
    if (status !== "loading") return;

    const controller = new AbortController();

    async function loadSession() {
      const response = await requestSession(agent, null, controller.signal);

      if (!response.ok) throw new Error("Chat session setup failed.");

      const session: Session = await response.json();
      if (controller.signal.aborted) return;
      setState({ status: "ready", session });
    }

    void loadSession().catch(() => {
      if (!controller.signal.aborted) setState({ status: "unavailable" });
    });
    return () => controller.abort();
  }, [agent, status]);

  if (state.status === "ready") {
    const { threadId, token } = state.session;
    function endSession() {
      setState((current) =>
        current.status === "ready" && current.session.token === token
          ? { status: "ended" }
          : current,
      );
    }

    return (
      <CopilotKit
        key={threadId}
        runtimeUrl={runtimeUrl}
        agent={agent}
        threadId={threadId}
        headers={{ Authorization: `Bearer ${token}` }}
      >
        <SessionExpiryObserver
          agent={agent}
          token={token}
          onExpiry={endSession}
        />
        {children}
      </CopilotKit>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
      {state.status === "loading" ? (
        <p role="status">Loading chat…</p>
      ) : (
        <>
          <p role="alert">
            {state.status === "ended"
              ? "This chat session has ended."
              : "Chat is temporarily unavailable."}
          </p>
          <button
            type="button"
            className="rounded-md border px-3 py-2"
            onClick={() => setState({ status: "loading" })}
          >
            {state.status === "ended" ? "Start a new chat" : "Try again"}
          </button>
        </>
      )}
    </div>
  );
}
