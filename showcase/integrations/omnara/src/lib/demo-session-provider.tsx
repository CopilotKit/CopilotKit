"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { DemoAgentId } from "./agents";

type Session = { threadId: string; token: string };
type SessionState =
  | { status: "loading" | "ended" | "unavailable" }
  | { status: "ready"; session: Session };

const runtimeUrl = "/api/copilotkit";

function storedToken(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeToken(key: string, token: string) {
  try {
    sessionStorage.setItem(key, token);
  } catch {
    // Some browsers restrict storage in iframes. The current chat still works.
  }
}

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

export function DemoSessionProvider({
  agent,
  children,
}: {
  agent: DemoAgentId;
  children: ReactNode;
}) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [attempt, setAttempt] = useState({ number: 0, startFresh: false });

  useEffect(() => {
    const controller = new AbortController();
    const storageKey = `omnara-session:${agent}`;
    const token = attempt.startFresh ? null : storedToken(storageKey);

    async function loadSession() {
      const response = await requestSession(agent, token, controller.signal);

      if (controller.signal.aborted) return;
      if (response.status === 401) {
        setState({ status: "ended" });
        return;
      }
      if (!response.ok) throw new Error("Chat session setup failed.");

      const session: Session = await response.json();
      if (controller.signal.aborted) return;
      storeToken(storageKey, session.token);
      setState({ status: "ready", session });
    }

    void loadSession().catch(() => {
      if (!controller.signal.aborted) setState({ status: "unavailable" });
    });
    return () => controller.abort();
  }, [agent, attempt]);

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
        onError={({ code, context }) => {
          if (context?.runtimeStatus === 401) {
            endSession();
          } else if (code === "agent_run_failed") {
            // A restarted runtime also rejects turns in an already open chat.
            void requestSession(agent, token)
              .then((response) => {
                if (response.status === 401) endSession();
              })
              .catch(() => {});
          }
        }}
      >
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
            onClick={() => {
              setAttempt(({ number, startFresh }) => ({
                number: number + 1,
                startFresh: startFresh || state.status === "ended",
              }));
              setState({ status: "loading" });
            }}
          >
            {state.status === "ended" ? "Start a new chat" : "Try again"}
          </button>
        </>
      )}
    </div>
  );
}
