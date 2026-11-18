"use client";

import { useMemo, useState } from "react";
import { useRecording } from "@/shell/teach";
import { cn } from "@/lib/utils";
import { useLogistics } from "../actions";
import { usePlannerAuth } from "./planner-auth-context";
import { blockedByAuthority, formatUsd } from "../data/authority";
import {
  ESCALATION_CODES,
  ESCALATION_CODE_LABELS,
} from "../data/escalation-codes";

/**
 * BEAT 6 — the PLANNER-FACING escalation filing form.
 *
 * This is the ONE surface in the skin where the escalation-code vocabulary may
 * legitimately appear, and the asymmetry is the entire beat: a HUMAN reads this
 * menu, the agent does not. Meridian holds no readable, no schema enum, no
 * prompt sentence and no error body naming these codes — it learns which one
 * lifts the authority gate by WATCHING the planner pick one here. That is why
 * `ESCALATION_CODE_LABELS` exists at all, and why importing it into `tools.tsx`
 * or `agent.ts` is a lint error (`withheldGateVocabulary` in
 * `eslint.config.mjs`); importing it HERE is the sanctioned case.
 *
 * ── THE MENU IS UNDIFFERENTIATED ON PURPOSE ─────────────────────────────────
 * Justifying codes and decoys are listed together in catalogue order, with no
 * mark, no grouping and no hint of which is which. A form that flagged the
 * working codes would make the demonstration a guided tour: the planner would be
 * following an instruction the app gave them, not exercising knowledge only they
 * have. The decoys' own labels say "(recorded only)" because that is what they
 * honestly are on the decision log — it is not a tell about the gate, and a
 * planner who files one will watch the release stay blocked, which is the
 * demonstration working exactly as designed.
 *
 * ── THE RECORDING BRACKETS ──────────────────────────────────────────────────
 * Both write paths bracket themselves with `beginRecording()` / `endRecording()`
 * from the shell's recorder. Those brackets are REF-COUNTED and NESTED inside
 * the outer one the chat's demonstration card holds open from "show me" until
 * "I'm done" — that outer bracket is what keeps the feed alive across the two
 * separate clicks and stops the ref count reaching zero between them, which
 * would clear the feed and STRAND the demonstrated code. This form's own
 * brackets exist so the feed and the glow still appear when a planner files an
 * escalation off their own bat, with no chat involved.
 *
 * The filing step carries the code as DATA — `logStep(label, code)` — because
 * `getDemonstratedCode()` reads the last CODED step. It is deliberately the code
 * the planner ACTUALLY filed, decoy or not: a recorder that quietly corrected
 * them would report a procedure that was never demonstrated.
 */

/** The result line the form shows the planner. `tone` drives the colour only. */
interface Note {
  tone: "positive" | "negative" | "neutral";
  text: string;
}

export function EscalationFilingForm() {
  const { shipments, lanes, fileEscalation, commitMitigation } = useLogistics();
  const { currentPlanner } = usePlannerAuth();
  const { beginRecording, endRecording, logStep } = useRecording();

  const [shipmentId, setShipmentId] = useState("");
  const [code, setCode] = useState<string>(ESCALATION_CODES[0]);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  /** The code whose escalation this session has filed and approved, if any. */
  const [filedCode, setFiledCode] = useState<string | null>(null);

  const cases = useMemo(
    () => blockedByAuthority(shipments, lanes, currentPlanner.authorityUsd),
    [shipments, lanes, currentPlanner.authorityUsd],
  );

  // Fall back to the first case rather than storing a default in state: the
  // ledger arrives asynchronously, so a `useState(cases[0])` would freeze on the
  // empty pre-fetch list forever.
  const selected = cases.find((c) => c.shipment.id === shipmentId) ?? cases[0];

  if (cases.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
        {currentPlanner.authorityUsd === null
          ? `${currentPlanner.name} approves without a limit — nothing on the network needs an escalation.`
          : "Nothing on the network is above your approval authority right now."}
      </p>
    );
  }

  const { shipment, option } = selected;
  const filedForThisShipment = filedCode !== null && shipmentId === shipment.id;

  const onFile = async () => {
    setBusy(true);
    setNote(null);
    beginRecording();
    logStep(`Opened the escalation form on ${shipment.reference}`);
    try {
      const outcome = await fileEscalation({
        shipmentId: shipment.id,
        code,
        rationale,
      });
      if (!outcome.ok) {
        // A code the catalogue does not hold is refused here WITHOUT the
        // catalogue being listed back. Narrated into the feed so the agent sees
        // that the attempt happened and failed — a silent failure would let it
        // conclude the step succeeded.
        logStep(`The escalation was refused on ${shipment.reference}`);
        setNote({ tone: "negative", text: outcome.error });
        return;
      }
      // THE CODED STEP. `getDemonstratedCode()` returns the last step carrying a
      // code, so this one call is what the chat's demonstration card reads back.
      logStep(`Filed the escalation as ${code}`, code);
      setFiledCode(code);
      setShipmentId(shipment.id);
      setNote({
        tone: "neutral",
        text: `Escalation ${code} is approved on ${shipment.reference}. Release the ${option.kind} to see whether it clears.`,
      });
    } finally {
      endRecording();
      setBusy(false);
    }
  };

  const onRelease = async () => {
    setBusy(true);
    setNote(null);
    beginRecording();
    try {
      const outcome = await commitMitigation({
        shipmentId: shipment.id,
        kind: option.kind,
        rationale: rationale || `Released under escalation ${filedCode ?? ""}`,
      });
      if (!outcome.ok) {
        // The DECOY path, and it must read as a real refusal rather than an
        // error state: a catalogued code that does not justify files fine and
        // lifts nothing. This is the moment the demonstration teaches which half
        // of the catalogue matters.
        logStep(
          `Re-attempted the ${option.kind} on ${shipment.reference} — still blocked`,
        );
        setNote({ tone: "negative", text: outcome.error });
        return;
      }
      logStep(
        `Released the ${option.kind} on ${shipment.reference} — the block lifted`,
      );
      setFiledCode(null);
      setNote({
        tone: "positive",
        text: `Released the ${option.kind} on ${shipment.reference} at ${formatUsd(option.costUsd)}.`,
      });
    } finally {
      endRecording();
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 shadow-soft">
      <p className="text-sm text-ink-muted">
        {shipment.reference}&rsquo;s cheapest usable option is the{" "}
        <span className="font-medium text-ink">{option.kind}</span> at{" "}
        <span className="font-medium text-ink">
          {formatUsd(option.costUsd)}
        </span>
        , above your {formatUsd(currentPlanner.authorityUsd ?? 0)} approval
        authority. File an escalation to release it.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Shipment
          <select
            aria-label="Shipment needing an escalation"
            value={shipment.id}
            onChange={(e) => {
              setShipmentId(e.target.value);
              setFiledCode(null);
              setNote(null);
            }}
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink"
          >
            {cases.map((c) => (
              <option key={c.shipment.id} value={c.shipment.id}>
                {c.shipment.reference} — {c.option.kind}{" "}
                {formatUsd(c.option.costUsd)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Escalation code
          <select
            aria-label="Escalation code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink"
          >
            {ESCALATION_CODES.map((c) => (
              <option key={c} value={c}>
                {ESCALATION_CODE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
          Why
          <input
            aria-label="Escalation rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="One line for the decision log"
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onFile()}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
        >
          File escalation
        </button>
        {/* Only offered once an escalation is on file for THIS shipment. The
            release is a separate click on purpose: the room has to see the
            refused write re-attempted and either clear or stay blocked, which is
            what makes the decoy legible. */}
        <button
          type="button"
          disabled={busy || !filedForThisShipment}
          onClick={() => void onRelease()}
          className={cn(
            "rounded-md border px-3 py-1.5 text-xs font-medium",
            filedForThisShipment
              ? "border-brand/50 bg-brand-soft text-brand-indigo hover:opacity-90 dark:text-brand-violet"
              : "border-hairline text-ink-muted",
            "disabled:opacity-50",
          )}
        >
          Release the {option.kind}
        </button>
      </div>

      {note ? (
        <p
          className={cn(
            "text-xs",
            note.tone === "positive" && "text-positive",
            note.tone === "negative" && "text-negative",
            note.tone === "neutral" && "text-ink-muted",
          )}
        >
          {note.text}
        </p>
      ) : null}
    </div>
  );
}

export default EscalationFilingForm;
