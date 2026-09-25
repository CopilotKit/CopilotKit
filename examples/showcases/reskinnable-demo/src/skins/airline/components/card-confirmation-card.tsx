"use client";

import { useId, useState } from "react";
import {
  cardConfirmationGuidance,
  readCardLast4,
} from "@/skins/airline/data/card-authorization";
import { formatUsd } from "@/skins/airline/data/fare-rules";

/**
 * BEAT 3a — the last four digits of the card on file never leave this
 * component. They are POSTed straight to `/api/airline/v1/authorizations`; the
 * agent's `respond()` receives only the confirmation sentence composed below.
 * That is the whole point of the beat — the mutation is agent-INITIATED and its
 * sensitive payload never enters the conversation, so the inspector's event
 * stream shows the sentence and nothing else.
 *
 * ⚠️ IT IS A SECOND FACTOR, NEVER AN ENTITLEMENT OVERRIDE. The route re-runs the
 * SAME `checkFareChange()` the ordinary change route runs, on figures it
 * recomputes itself, so a valid confirmation on a non-changeable fare is still
 * `422 FARE_NOT_CHANGEABLE` — and this card renders that refusal rather than
 * swallowing it. Nothing here is allowed to become a second door around beat 6's
 * gate: the caller (`tools.tsx`) offers this card ONLY on options
 * `offerableOptions()` returned — the client mirror of the server's own
 * `authorizableOptions()` — and even if it did not, the server would still
 * refuse. `src/app/api/airline/v1/authorizations/route.test.ts` walks every
 * option on all three gated bookings and pins that separation.
 *
 * Both the printed guidance and the submit predicate come from
 * `cardConfirmationGuidance()` / `readCardLast4()`, so the card cannot advertise
 * a format it then refuses.
 */
export function CardConfirmationCard({
  bookingReference,
  flightNumber,
  optionId,
  amountDueUsd,
  cardLabel,
  onAuthorized,
  onDeclined,
}: {
  bookingReference: string;
  flightNumber: string;
  optionId: string;
  amountDueUsd: number;
  cardLabel: string;
  onAuthorized: (message: string) => void;
  onDeclined: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Three states, not a boolean. On success the card normally UNMOUNTS —
  // `respond()` settles the interrupt and the render swaps to its terminal
  // branch — but that is the caller's behaviour, not this component's
  // guarantee. A plain `submitting` flag cleared only on the failure paths
  // leaves the card reading "Confirming…" with both buttons dead and nothing on
  // screen explaining it. "authorized" is a SETTLED state with its own copy, and
  // it still refuses a second click, so the write cannot be issued twice.
  const [phase, setPhase] = useState<"idle" | "submitting" | "authorized">(
    "idle",
  );
  const busy = phase !== "idle";
  const inputId = useId();
  const { hint, length } = cardConfirmationGuidance(cardLabel);
  const money = formatUsd(amountDueUsd);

  const submit = async () => {
    // NEVER silently disable the button on an unread value: say why, in the
    // helper's own words. A disabled control with nothing on screen explaining
    // it is the failure this beat's guidance calls out by name — the presenter
    // follows the card's instruction and the card just sits there.
    const verdict = readCardLast4(typed);
    if (!verdict.ok) {
      setError(
        "untouched" in verdict
          ? "Enter the last four digits to confirm."
          : verdict.reason,
      );
      return;
    }
    setPhase("submitting");
    try {
      const res = await fetch("/api/airline/v1/authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking: bookingReference,
          optionId,
          // The one place the digits travel: this request. They are never put
          // into `onAuthorized`, never logged, and never echoed by the route.
          cardLast4: verdict.last4,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!res.ok) {
        setPhase("idle");
        // The server's own sentence, verbatim. A `FARE_NOT_CHANGEABLE` here is
        // the gate refusing a paid change, and replacing it with a generic
        // "could not authorize" is exactly how the room would fail to notice
        // that the second factor did NOT override the entitlement.
        setError(body?.message ?? "That card confirmation was not accepted.");
        return;
      }
      setPhase("authorized");
      // The agent learns only this sentence.
      onAuthorized(
        `${bookingReference} is reissued onto ${flightNumber} for ${money}. ` +
          `The card digits stayed in the card and were never sent to you.`,
      );
    } catch (err) {
      console.error("[airline] card authorization failed:", err);
      setPhase("idle");
      setError("The confirmation could not be sent. Nothing was charged.");
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
      <div className="text-sm text-ink">
        Confirm <span className="font-semibold text-brand">{money}</span> to
        move <span className="font-mono font-semibold">{bookingReference}</span>{" "}
        onto <span className="font-mono font-semibold">{flightNumber}</span>
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
          Confirmed — the reissue is on the trip record. This card is finished.
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
            ? "Confirming…"
            : phase === "authorized"
              ? "Confirmed"
              : "Confirm and pay"}
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

export default CardConfirmationCard;
