"use client";

import { useId, useState } from "react";
import {
  plannerPinGuidance,
  readPlannerPin,
} from "@/skins/logistics/data/planner-pin";
import type { MitigationKind } from "@/skins/logistics/data/types";

/**
 * BEAT 3a — the planner's approval PIN never leaves this component. It is
 * POSTed straight to `/api/logistics/v1/authorizations`; the agent's `respond()`
 * receives only the confirmation sentence composed below. That is the whole
 * point of the beat — the mutation is agent-INITIATED and its sensitive payload
 * never enters the conversation, so the inspector's event stream shows the
 * sentence and nothing else.
 *
 * The PIN is a SECOND FACTOR on a mitigation the planner may already commit; the
 * server still runs the authority gate on a cost it recomputes, so a PIN can
 * never release an over-authority spend. The caller is responsible for offering
 * only an under-authority option (see `tools.tsx`).
 *
 * Both the printed guidance and the submit predicate come from
 * `plannerPinGuidance()` / `readPlannerPin()`, so the card cannot advertise a
 * format it then refuses.
 */
export function PlannerPinCard({
  shipmentReference,
  kind,
  costUsd,
  plannerId,
  onAuthorized,
  onDeclined,
}: {
  shipmentReference: string;
  kind: MitigationKind;
  costUsd: number;
  plannerId: string;
  onAuthorized: (message: string) => void;
  onDeclined: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Three states, not a boolean. On success the card normally UNMOUNTS — respond()
  // settles the interrupt and the render swaps to its terminal branch — but that
  // is the caller's behaviour, not this component's guarantee. A plain
  // `submitting` flag that is only ever cleared on the failure paths therefore
  // leaves the card reading "Authorizing…" with both buttons dead and nothing on
  // screen explaining it, if the unmount does not come. That is the same failure
  // the comment in `submit` argues against, arriving from the other direction.
  // "authorized" is a SETTLED state with its own copy, and it still refuses a
  // second click, so the write cannot be issued twice.
  const [phase, setPhase] = useState<"idle" | "submitting" | "authorized">(
    "idle",
  );
  const busy = phase !== "idle";
  const inputId = useId();
  const { hint, length } = plannerPinGuidance();
  const money = `$${costUsd.toLocaleString("en-US")}`;

  const submit = async () => {
    // NEVER silently disable the button on an unread value: say why, in the
    // helper's own words. A disabled control with nothing on screen explaining
    // it is the failure this beat's guidance calls out by name — the presenter
    // follows the card's instruction and the card just sits there.
    const verdict = readPlannerPin(typed);
    if (!verdict.ok) {
      setError(
        "untouched" in verdict
          ? "Enter your PIN to authorize."
          : verdict.reason,
      );
      return;
    }
    setPhase("submitting");
    try {
      const res = await fetch("/api/logistics/v1/authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipment: shipmentReference,
          kind,
          // The one place the digits travel: this request. They are never put
          // into `onAuthorized`, never logged, and never echoed by the route.
          pin: verdict.pin,
          plannerId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPhase("idle");
        setError(body?.message ?? "That PIN was not accepted.");
        return;
      }
      setPhase("authorized");
      // The agent learns only this sentence.
      onAuthorized(
        `${kind} authorized on ${shipmentReference} at ${money}. ` +
          `The PIN stayed in the card and was never sent to you.`,
      );
    } catch (err) {
      console.error("[logistics] authorization failed:", err);
      setPhase("idle");
      setError("The authorization could not be sent. Nothing was released.");
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
      <div className="text-sm text-ink">
        Authorize the {kind}{" "}
        <span className="font-semibold text-brand">{money}</span> on{" "}
        <span className="font-mono font-semibold">{shipmentReference}</span>
      </div>
      <label className="text-xs text-ink-muted" htmlFor={inputId}>
        {hint}
      </label>
      <input
        id={inputId}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={length}
        value={typed}
        disabled={busy}
        onChange={(e) => {
          setTyped(e.target.value);
          setError(null);
        }}
        className="w-32 rounded-md border border-hairline bg-canvas px-3 py-2 font-mono text-sm tracking-widest"
      />
      {error ? <p className="text-xs text-negative">{error}</p> : null}
      {phase === "authorized" ? (
        <p className="text-xs text-ink-muted">
          Authorized — the release is recorded. This card is finished.
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90 disabled:opacity-40"
          onClick={() => void submit()}
        >
          {phase === "submitting"
            ? "Authorizing…"
            : phase === "authorized"
              ? "Authorized"
              : "Authorize"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted disabled:opacity-40"
          onClick={onDeclined}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default PlannerPinCard;
