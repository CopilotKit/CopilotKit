"use client";

import { useState } from "react";
import type { InterruptRenderProps } from "@copilotkit/react-core/v2";
import type { InteractionForm } from "@omnara/sdk";

type Interrupt = InterruptRenderProps["interrupts"][number];

/** The adapter puts Omnara's approval or question form on each interrupt. */
function formOf(interrupt: Interrupt): InteractionForm | undefined {
  return (
    interrupt.metadata as { omnara?: { form?: InteractionForm } } | undefined
  )?.omnara?.form;
}

/**
 * Omnara approvals and questions arrive as AG-UI interrupts. The agent resumes
 * once every open one is answered. Dismiss answers a question with its
 * "Other" option.
 */
export function Interactions({
  interrupts,
  resolve,
  cancel,
}: Pick<InterruptRenderProps, "interrupts" | "resolve" | "cancel">) {
  return (
    <>
      {interrupts.map((interrupt) => (
        <Interaction
          key={interrupt.id}
          interrupt={interrupt}
          answer={(payload) => resolve(payload, interrupt.id)}
          dismiss={() => cancel(interrupt.id)}
        />
      ))}
    </>
  );
}

function Interaction({
  interrupt,
  answer,
  dismiss,
}: {
  interrupt: Interrupt;
  answer: (payload: unknown) => Promise<unknown>;
  dismiss: () => Promise<unknown>;
}) {
  const [picked, setPicked] = useState<number[][]>([]);
  const [details, setDetails] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const form = formOf(interrupt);
  if (!form) return null;
  // The SDK logs a failed resume, and page.tsx recovers the thread.
  const done = (label: string, act: () => Promise<unknown>) => () => {
    setStatus(label);
    act().catch(() => {});
  };
  const context = form.context?.length ? (
    <dl className="interaction-context">
      {form.context.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  ) : null;
  const footer = status ? <p className="interaction-status">{status}</p> : null;

  if (interrupt.reason === "omnara:permission")
    return (
      <fieldset className="interaction" disabled={status !== null}>
        <legend>{form.title}</legend>
        {context}
        <div className="interaction-actions">
          <button
            type="button"
            className="primary"
            onClick={done("Allowed", () => answer({ approved: true }))}
          >
            Allow
          </button>
          <button
            type="button"
            onClick={done("Denied", () => answer({ approved: false }))}
          >
            Deny
          </button>
        </div>
        {footer}
      </fieldset>
    );

  const pick = (q: number, o: number, multiple?: boolean) =>
    setPicked((current) => {
      const next = [...current];
      const chosen = next[q] ?? [];
      next[q] = !multiple
        ? [o]
        : chosen.includes(o)
          ? chosen.filter((i) => i !== o)
          : [...chosen, o];
      return next;
    });
  const complete = form.questions.every((_, q) => picked[q]?.length);
  const takesText = (q: number) =>
    (picked[q] ?? []).some((o) => form.questions[q].options[o]?.allows_text);
  const answers = form.questions.map((_, q) => ({
    optionIndices: picked[q] ?? [],
    ...(takesText(q) && details[q]?.trim() ? { text: details[q].trim() } : {}),
  }));
  return (
    <fieldset className="interaction" disabled={status !== null}>
      <legend>{form.title}</legend>
      {context}
      {form.questions.map((question, q) => (
        <fieldset key={q} className="interaction-question">
          <legend>{question.prompt}</legend>
          <div className="interaction-actions">
            {question.options.map((option, o) => (
              <button
                key={o}
                type="button"
                aria-pressed={picked[q]?.includes(o) ?? false}
                onClick={() => pick(q, o, question.multiple)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {takesText(q) && (
            <input
              type="text"
              aria-label="Details (optional)"
              placeholder="Details (optional)"
              value={details[q] ?? ""}
              onChange={(event) => {
                const next = [...details];
                next[q] = event.target.value;
                setDetails(next);
              }}
            />
          )}
        </fieldset>
      ))}
      <div className="interaction-actions">
        <button
          type="button"
          className="primary"
          disabled={!complete}
          onClick={done("Answered", () => answer({ answers }))}
        >
          Submit
        </button>
        <button type="button" onClick={done("Dismissed", dismiss)}>
          Dismiss
        </button>
      </div>
      {footer}
    </fieldset>
  );
}
