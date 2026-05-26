"use client";

/**
 * Left-pane control that triggers a **per-turn structured-output** run.
 *
 * The button dispatches a normal user message asking the agent for a
 * fixture diagnosis, but it also threads the OpenAI-shaped `responseFormat`
 * directive through AG-UI's `forwardedProps`. Our app-side
 * `ForwardedPropsResponseFormatPromoter` (see `agent/`) promotes that into
 * the agent's per-call `ChatOptions.ResponseFormat`, so the LLM's final
 * assistant message is constrained to the `FixtureDiagnosis` schema.
 *
 * The framework (MAF / CopilotKit / AG-UI) is intentionally NOT in the
 * loop — the application owns both ends of the contract.
 */

import { useSendUserMessage } from "@/hooks/use-control-room-state";
import { fixtureDiagnosisResponseFormat } from "@/lib/fixture-diagnosis-schema";

const DIAGNOSIS_PROMPT =
  "Emit a structured diagnosis of the current fixture: " +
  "summary of the bug, the file + minimal change that fixes it, and " +
  "the verification command. Respond as JSON only — your response will " +
  "be parsed by the FixtureDiagnosis schema.";

export function StructuredOutputControl() {
  const { send, isRunning } = useSendUserMessage();

  const runStructured = () => {
    if (isRunning) return;
    void send(DIAGNOSIS_PROMPT, {
      forwardedProps: { responseFormat: fixtureDiagnosisResponseFormat() },
    });
  };

  return (
    <div>
      <h3 className="cr-heading mb-2">Structured output</h3>
      <button
        type="button"
        onClick={runStructured}
        disabled={isRunning}
        className="cr-btn w-full"
        data-variant="ghost"
      >
        Run structured diagnosis
      </button>
      <p
        className="mt-2 text-[10px] uppercase leading-snug tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        Per-turn JSON schema · pinned via forwardedProps
      </p>
    </div>
  );
}
