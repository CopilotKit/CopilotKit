"use client";

/**
 * Right-pane inspector for the most recent **structured-output** response.
 *
 * The Control Room frontend can ask the agent to return JSON matching a
 * specific schema by passing the directive through AG-UI's `forwardedProps`:
 *
 *     copilotkit.runAgent({
 *       agent,
 *       forwardedProps: { responseFormat: { type: "json_schema", json_schema: { ... } } },
 *     })
 *
 * Our app's `ForwardedPropsResponseFormatPromoter` (a DelegatingChatClient
 * wrapper, in `agent/`) reads that directive and promotes it into the
 * agent's per-call `ChatOptions.ResponseFormat`. MAF then constrains the
 * underlying LLM call to the schema, and the final assistant message
 * arrives as valid JSON.
 *
 * `useControlRoomAgentState` parses it and exposes it as
 * `structuredDiagnosis`; this card renders the typed fields.
 *
 * Native primitive — no wrapper badge.
 */

import { useControlRoomAgentState } from "@/hooks/use-control-room-state";

export function StructuredDiagnosisPanel() {
  const { structuredDiagnosis } = useControlRoomAgentState();

  return (
    <div className="cr-card">
      <h3 className="cr-heading mb-2">Structured diagnosis</h3>
      {!structuredDiagnosis ? (
        <p
          className="text-[10.5px] uppercase leading-snug tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          No structured response yet · trigger one via the left pane
        </p>
      ) : (
        <dl className="cr-dl">
          <dt>Summary</dt>
          <dd className="leading-snug">
            {structuredDiagnosis.payload.summary}
          </dd>
          <dt>Fix file</dt>
          <dd className="text-[var(--cr-amber)]">
            {structuredDiagnosis.payload.fix.file}
          </dd>
          <dt>Change</dt>
          <dd className="leading-snug">
            {structuredDiagnosis.payload.fix.change}
          </dd>
          <dt>Verify</dt>
          <dd>
            <span className="cr-chip" style={{ fontSize: "10px" }}>
              pnpm_run · {structuredDiagnosis.payload.verification.test_command}
            </span>
            <span
              className="ml-2 cr-chip"
              style={{ fontSize: "10px" }}
              data-tone={
                structuredDiagnosis.payload.verification.expected_exit_code ===
                0
                  ? "emerald"
                  : "amber"
              }
            >
              exit {structuredDiagnosis.payload.verification.expected_exit_code}
            </span>
          </dd>
        </dl>
      )}
      <p
        className="mt-3 text-[10px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        Per-turn directive via `forwardedProps.responseFormat`
      </p>
    </div>
  );
}
