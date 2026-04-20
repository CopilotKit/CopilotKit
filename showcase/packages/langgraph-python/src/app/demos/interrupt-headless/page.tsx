"use client";

// Headless Interrupt cell — hello-world use-case for `useHeadlessInterrupt`.
//
// Single button kicks off the agent. The backend calls `schedule_meeting`
// (LangGraph `interrupt()`), which `useHeadlessInterrupt` surfaces via
// `pending`. A centered modal (portal'd to <body>, outside any chat
// surface) offers 4 slots + Cancel. Selecting one calls `resolve(...)`,
// resumes the agent, closes the modal, and shows the final result in a
// small card below the kick-off button.

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
      <div className="flex min-h-screen w-full items-center justify-center bg-[#FAFAFC] p-6">
        <HeadlessInterruptPanel />
      </div>
    </CopilotKit>
  );
}

// @region[headless-useinterrupt-primitives]
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
// @endregion[headless-useinterrupt-primitives]

function HeadlessInterruptPanel() {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: "interrupt-headless" });
  const { pending, resolve } = useHeadlessInterrupt("interrupt-headless");
  const [runId, setRunId] = useState(0);

  const kickOff = () => {
    if (agent.isRunning) return;
    // Bump the run marker so the old result hides immediately and the
    // ResultCard only reappears after the NEW run's assistant reply lands.
    setRunId((n) => n + 1);
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: "Schedule a meeting with the team.",
    });
    void copilotkit.runAgent({ agent }).catch(() => {});
  };

  // Show the latest assistant message — but only if it was produced AFTER
  // the most recent kickoff (prevents the previous round's result from
  // flashing under the button during the second run's pre-interrupt phase).
  const lastAssistant = [...agent.messages]
    .reverse()
    .find((m) => m.role === "assistant" && typeof m.content === "string") as
    | { content: string }
    | undefined;

  const busy = agent.isRunning || pending !== null;

  return (
    <div className="w-full max-w-md">
      <div
        className="rounded-2xl border border-[#DBDBE5] bg-white p-8 shadow-sm"
        data-testid="interrupt-headless-panel"
      >
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
          Headless interrupt
        </div>
        <h1 className="mb-2 text-xl font-semibold text-[#010507]">
          Schedule a meeting
        </h1>
        <p className="mb-6 text-sm text-[#57575B]">
          Click the button below. The agent will pause on a LangGraph{" "}
          <code className="rounded bg-[#F0F0F4] px-1 py-0.5 font-mono text-xs text-[#010507]">
            interrupt()
          </code>{" "}
          and the popup will ask you to pick a time — no chat needed.
        </p>

        <button
          type="button"
          data-testid="interrupt-headless-kickoff"
          onClick={kickOff}
          disabled={busy}
          className="w-full rounded-xl bg-[#010507] px-4 py-3 text-sm font-medium uppercase tracking-[0.12em] text-white transition-colors hover:bg-[#2B2B2B] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {agent.isRunning && !pending
            ? "Working…"
            : pending
              ? "Awaiting your choice…"
              : "Schedule meeting"}
        </button>

        {runId > 0 && !pending && lastAssistant?.content ? (
          <ResultCard content={lastAssistant.content} />
        ) : null}
      </div>

      {pending ? (
        <TimeSlotModal
          payload={pending.value}
          onPick={(slot) =>
            resolve({ chosen_time: slot.iso, chosen_label: slot.label })
          }
          onCancel={() => resolve({ cancelled: true })}
        />
      ) : null}
    </div>
  );
}

function ResultCard({ content }: { content: string }) {
  return (
    <div
      data-testid="interrupt-headless-result"
      className="mt-6 rounded-xl border border-[#E9E9EF] bg-[#FAFAFC] p-4"
    >
      <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#189370]">
        Result
      </div>
      <div className="whitespace-pre-wrap text-sm text-[#010507]">
        {content}
      </div>
    </div>
  );
}

type TimeSlotModalProps = {
  payload: InterruptPayload;
  onPick: (slot: TimeSlot) => void;
  onCancel: () => void;
};

function TimeSlotModal({ payload, onPick, onCancel }: TimeSlotModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const content = (
    <div
      data-testid="interrupt-headless-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#010507]/40 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="interrupt-headless-modal"
        className="w-full max-w-md rounded-2xl border border-[#DBDBE5] bg-white p-6 shadow-sm"
      >
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
          Pick a time
        </div>
        <h2 className="mb-1 text-lg font-semibold text-[#010507]">
          {payload.topic ?? "Meeting"}
        </h2>
        {payload.attendee ? (
          <p className="mb-5 text-sm text-[#57575B]">
            with{" "}
            <span className="font-medium text-[#010507]">
              {payload.attendee}
            </span>
          </p>
        ) : (
          <div className="mb-5" />
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DEFAULT_SLOTS.map((slot) => (
            <button
              key={slot.iso}
              type="button"
              data-testid={`interrupt-headless-slot-${slot.iso}`}
              onClick={() => onPick(slot)}
              className="rounded-xl border border-[#DBDBE5] bg-white px-3 py-3 text-sm font-medium text-[#010507] transition-colors hover:border-[#BEC2FF] hover:bg-[#BEC2FF1A]"
            >
              {slot.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          data-testid="interrupt-headless-cancel"
          onClick={onCancel}
          className="mt-4 w-full rounded-xl border border-[#DBDBE5] bg-white px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-[#57575B] transition-colors hover:bg-[#FAFAFC]"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
