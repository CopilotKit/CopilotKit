"use client";

// Headless Interrupt cell — no <CopilotChat>, no `useInterrupt` render prop.
//
// RESEARCH CONTEXT
// ----------------
// As of this commit, the v2 surface does not expose a render-less variant of
// `useInterrupt` (the `render` callback is required in `UseInterruptConfig`),
// nor does `useAgent({ agentId })` surface the current interrupt state or a
// `respond()` helper — it only returns `{ agent }`.
//
// What IS exposed, however, are the lower-level primitives that `useInterrupt`
// composes internally:
//   * `agent.subscribe({ onCustomEvent, onRunStartedEvent, onRunFinalized, onRunFailed })`
//     — AG-UI agent event subscription, available on every `AbstractAgent`.
//   * `copilotkit.runAgent({ agent, forwardedProps: { command: { resume, interruptEvent } } })`
//     — the same call `useInterrupt`'s `resolve()` uses to resume the paused run.
//
// This cell demonstrates using those primitives directly to build a headless
// interrupt resolver: a plain button grid listens for the `on_interrupt` custom
// event, stores the payload, and resolves with the user's chosen slot.
//
// This mirrors what `useInterrupt` does under the hood (see
// packages/react-core/src/v2/hooks/use-interrupt.tsx) but factored so the UI
// can live anywhere in the tree and look like anything — no chat required.

import React, { useEffect, useMemo, useState } from "react";
import { CopilotKit, useAgent, useCopilotKit } from "@copilotkit/react-core/v2";

const INTERRUPT_EVENT_NAME = "on_interrupt";

type InterruptPayload = {
  topic?: string;
  attendee?: string;
};

type InterruptEvent = {
  name: string;
  value: InterruptPayload;
};

type TimeSlot = { label: string; iso: string };

const DEFAULT_SLOTS: TimeSlot[] = [
  { label: "Tomorrow 10:00 AM", iso: "2026-04-19T10:00:00-07:00" },
  { label: "Tomorrow 2:00 PM", iso: "2026-04-19T14:00:00-07:00" },
  { label: "Monday 9:00 AM", iso: "2026-04-21T09:00:00-07:00" },
  { label: "Monday 3:30 PM", iso: "2026-04-21T15:30:00-07:00" },
];

export default function InterruptHeadlessDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="interrupt-headless">
      <div className="flex justify-center items-start min-h-screen w-full p-6 bg-gray-50">
        <div className="w-full max-w-3xl">
          <HeadlessInterruptPanel />
        </div>
      </div>
    </CopilotKit>
  );
}

/**
 * Headless interrupt listener — the `useInterrupt` "equivalent" without a
 * `render` prop. Returns `{ pending, resolve }` so any UI can drive resolution.
 */
function useHeadlessInterrupt(agentId: string): {
  pending: InterruptEvent | null;
  resolve: (response: unknown) => void;
} {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId });
  const [pending, setPending] = useState<InterruptEvent | null>(null);

  useEffect(() => {
    let local: InterruptEvent | null = null;
    const sub = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name === INTERRUPT_EVENT_NAME) {
          local = {
            name: event.name,
            value: (event.value ?? {}) as InterruptPayload,
          };
        }
      },
      onRunStartedEvent: () => {
        local = null;
        setPending(null);
      },
      onRunFinalized: () => {
        if (local) {
          setPending(local);
          local = null;
        }
      },
      onRunFailed: () => {
        local = null;
      },
    });
    return () => sub.unsubscribe();
  }, [agent]);

  const resolve = useMemo(
    () => (response: unknown) => {
      const snapshot = pending;
      setPending(null);
      void copilotkit
        .runAgent({
          agent,
          forwardedProps: {
            command: {
              resume: response,
              interruptEvent: snapshot?.value,
            },
          },
        })
        .catch(() => {});
    },
    [agent, copilotkit, pending],
  );

  return { pending, resolve };
}

function HeadlessInterruptPanel() {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: "interrupt-headless" });
  const { pending, resolve } = useHeadlessInterrupt("interrupt-headless");

  const kickOff = (prompt: string) => {
    if (agent.isRunning) return;
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    });
    void copilotkit.runAgent({ agent }).catch(() => {});
  };

  const lastAssistant = [...agent.messages]
    .reverse()
    .find((m) => m.role === "assistant" && typeof m.content === "string") as
    | { content: string }
    | undefined;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">
          Headless Interrupt (no chat, no render prop)
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Trigger the backend <code>schedule_meeting</code> tool, then resolve
          its <code>interrupt()</code> from the button grid below. No{" "}
          <code>&lt;CopilotChat&gt;</code>, no <code>useInterrupt</code> render
          prop — just <code>useAgent</code>, <code>agent.subscribe</code>, and{" "}
          <code>copilotkit.runAgent</code>.
        </p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">
          1. Kick off a run
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Sends a user message and starts the agent. The backend will call{" "}
          <code>schedule_meeting</code>, which triggers{" "}
          <code>langgraph.interrupt(...)</code>.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() =>
              kickOff(
                "Book an intro call with the sales team to discuss pricing.",
              )
            }
            disabled={agent.isRunning || pending !== null}
          >
            Book sales intro
          </button>
          <button
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() =>
              kickOff("Schedule a 1:1 with Alice next week to review Q2 goals.")
            }
            disabled={agent.isRunning || pending !== null}
          >
            Schedule 1:1 with Alice
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">
          2. Resolve the interrupt
        </h2>
        {pending ? (
          <>
            <p className="mt-1 text-xs text-gray-500">
              Interrupt received for{" "}
              <span className="font-medium text-gray-800">
                {pending.value.topic ?? "a call"}
              </span>
              {pending.value.attendee ? (
                <>
                  {" "}
                  with{" "}
                  <span className="font-medium text-gray-800">
                    {pending.value.attendee}
                  </span>
                </>
              ) : null}
              . Pick a slot to resume the run.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {DEFAULT_SLOTS.map((slot) => (
                <button
                  key={slot.iso}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
                  onClick={() =>
                    resolve({
                      chosen_time: slot.iso,
                      chosen_label: slot.label,
                    })
                  }
                >
                  {slot.label}
                </button>
              ))}
              <button
                className="col-span-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => resolve({ cancelled: true })}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-gray-500">
            No interrupt pending. Kick off a run above.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">3. Result</h2>
        <div className="mt-2 text-xs text-gray-500">
          Status:{" "}
          <span className="font-medium text-gray-800">
            {agent.isRunning
              ? "running"
              : pending
                ? "awaiting interrupt"
                : "idle"}
          </span>
        </div>
        {lastAssistant?.content ? (
          <div className="mt-2 rounded-lg bg-gray-100 p-3 text-sm text-gray-900 whitespace-pre-wrap">
            {lastAssistant.content}
          </div>
        ) : (
          <div className="mt-2 text-xs text-gray-400">
            Agent response will appear here once the interrupt is resolved.
          </div>
        )}
      </section>
    </div>
  );
}
