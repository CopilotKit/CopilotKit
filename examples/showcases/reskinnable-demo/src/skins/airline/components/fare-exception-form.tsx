"use client";

import { useMemo, useState } from "react";
import { useRecording } from "@/shell/teach";
import { cn } from "@/lib/utils";
import { useAirlineLedger, notifyAirlineDataChanged } from "../ledger-context";
import { blockedByFare } from "./authorizable";
import {
  FARE_WAIVER_CODES,
  FARE_WAIVER_CODE_LABELS,
} from "../data/fare-waiver-codes";

/**
 * BEAT 6 — the PASSENGER-FACING fare-exception filing form.
 *
 * This is the ONE surface in the skin where the fare-waiver vocabulary may
 * legitimately appear, and the asymmetry is the entire beat: a HUMAN reads this
 * menu, the agent does not. Aeronova holds no readable, no schema enum, no prompt
 * sentence and no error body naming these categories — it learns which one lifts
 * the fare gate by WATCHING the passenger pick one here. That is why
 * `FARE_WAIVER_CODE_LABELS` exists at all, and why importing it into `tools.tsx`
 * or `agent.ts` is a test failure (`../tools.test.ts`, and ESLint's
 * `withheldGateVocabulary` once airline is added to its glob); importing it HERE
 * is the sanctioned case.
 *
 * ── THE MENU IS UNDIFFERENTIATED ON PURPOSE ─────────────────────────────────
 * Justifying categories and decoys are listed together in catalogue order, with
 * no mark, no grouping and no hint of which is which. A form that flagged the
 * working ones would make the demonstration a guided tour: the passenger would be
 * following an instruction the app gave them, not exercising knowledge only they
 * have. The decoys' own labels say "(recorded only)" because that is what they
 * honestly are on the trip record — it is not a tell about the gate, and a
 * passenger who files one will watch the reissue stay refused, which is the
 * demonstration working exactly as designed.
 *
 * ── AND THE GATE IS GROUNDED, NOT KEYED ON THE CATEGORY ALONE ───────────────
 * `exceptionLifts` requires the category to match what the booking's own record
 * documents (`data/fare-waiver-codes.ts`). So the procedure being demonstrated is
 * "read what the booking documents, file the matching category, approve it, then
 * retry the reissue" — a procedure rather than a memorized string, which is what
 * makes the unaided replay on a DIFFERENT booking a real claim. The form shows
 * each case's `fareNotes` prose for exactly that reason: it is where the
 * passenger reads what their booking documents, and it is deliberately free of
 * catalogue vocabulary.
 *
 * ── THE RECORDING BRACKETS ──────────────────────────────────────────────────
 * Both write paths bracket themselves with `beginRecording()` / `endRecording()`
 * from the shell's recorder. Those brackets are REF-COUNTED and NESTED inside the
 * outer one the chat's demonstration card holds open from "show me" until "I'm
 * done" — that outer bracket is what keeps the feed alive across the two separate
 * clicks and stops the ref count reaching zero between them, which would clear the
 * feed and STRAND the demonstrated category. This form's own brackets exist so the
 * feed and the glow still appear when a passenger files an exception off their own
 * bat, with no chat involved.
 *
 * The filing step carries the category as DATA — `logStep(label, code)` — because
 * `getDemonstratedCode()` reads the last CODED step. It is deliberately the
 * category the passenger ACTUALLY filed, decoy or not: a recorder that quietly
 * corrected them would report a procedure that was never demonstrated.
 */

const BASE = "/api/airline/v1";

/**
 * One write, and the sentence the form shows for it. Never throws: a rejected
 * button that leaves the form in a spinner is indistinguishable on stage from a
 * hung backend.
 */
async function post(
  path: string,
  body: Record<string, unknown>,
): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!res.ok) {
      return {
        ok: false,
        error:
          typeof payload?.message === "string"
            ? payload.message
            : `The request was refused (HTTP ${res.status}).`,
      };
    }
    notifyAirlineDataChanged();
    return { ok: true, data: payload ?? {} };
  } catch (error) {
    console.error(`[airline] POST ${path} failed:`, error);
    return { ok: false, error: "The request could not be sent." };
  }
}

/** The result line the form shows. `tone` drives the colour only. */
interface Note {
  tone: "positive" | "negative" | "neutral";
  text: string;
}

export function FareExceptionForm() {
  const { ready, bookings, flights, options, exceptions } = useAirlineLedger();
  const { beginRecording, endRecording, logStep } = useRecording();

  const [bookingId, setBookingId] = useState("");
  const [code, setCode] = useState<string>(FARE_WAIVER_CODES[0]);
  const [documentReference, setDocumentReference] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  /** The category whose exception this session has filed and approved, if any. */
  const [filedCode, setFiledCode] = useState<string | null>(null);

  const cases = useMemo(
    () => blockedByFare({ bookings, flights, options, exceptions }),
    [bookings, flights, options, exceptions],
  );

  // Fall back to the first case rather than storing a default in state: the
  // ledger arrives asynchronously, so a `useState(cases[0])` would freeze on the
  // empty pre-fetch list forever.
  //
  // ⚠️ It also has to survive the case DROPPING OFF the list, which is the normal
  // path here: once an approved exception is linked, `blockedByFare` is optimistic
  // and stops listing the booking even when the category was a decoy the server
  // will still refuse. Keeping the last selection is what lets the presenter press
  // "Retry the reissue" on the very case they just filed against.
  const selected =
    cases.find((c) => c.booking.id === bookingId) ??
    (bookingId ? null : (cases[0] ?? null));
  const held = useMemo(() => {
    if (!bookingId) return null;
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return null;
    const flight = flights.find((f) => f.id === booking.flightId) ?? null;
    const option =
      options
        .filter((o) => o.bookingId === booking.id)
        .sort((a, b) => a.fareDifferenceUsd - b.fareDifferenceUsd)[0] ?? null;
    return flight ? { booking, flight, option } : null;
  }, [bookingId, bookings, flights, options]);
  const active = selected ?? held;

  if (cases.length === 0 && !active) {
    return (
      <p className="rounded-lg border border-dashed border-hairline bg-surface px-4 py-3 text-sm text-ink-muted">
        {ready
          ? "Nothing on your account is refused by its fare right now."
          : "Checking which of your tickets can be changed…"}
      </p>
    );
  }
  if (!active) return null;

  const { booking, flight, option } = active;
  const filedForThisBooking = filedCode !== null && bookingId === booking.id;

  const onFile = async () => {
    setBusy(true);
    setNote(null);
    beginRecording();
    logStep(`Opened the fare exception form on ${booking.reference}`);
    try {
      if (documentReference.trim() === "") {
        // Refused BEFORE the request, and narrated, because the route's own
        // MISSING_DOCUMENTATION refusal would read on stage as the gate speaking
        // when it is really an empty text box.
        logStep(`The filing on ${booking.reference} had nothing behind it`);
        setNote({
          tone: "negative",
          text: "A fare exception has to cite the documentation behind it.",
        });
        return;
      }
      const filed = await post("/fare-exceptions", {
        booking: booking.id,
        code,
        documentReference,
        rationale,
      });
      if (!filed.ok) {
        // A category the catalogue does not hold is refused here WITHOUT the
        // catalogue being listed back. Narrated into the feed so the agent sees
        // that the attempt happened and failed — a silent failure would let it
        // conclude the step succeeded.
        logStep(`The fare exception was refused on ${booking.reference}`);
        setNote({ tone: "negative", text: filed.error });
        return;
      }
      const exception = filed.data.exception as { id?: string } | undefined;
      const approved = await post(
        `/fare-exceptions/${encodeURIComponent(exception?.id ?? "")}/approve`,
        {},
      );
      if (!approved.ok) {
        logStep(
          `The fare exception could not be approved on ${booking.reference}`,
        );
        setNote({ tone: "negative", text: approved.error });
        return;
      }
      // THE CODED STEP. `getDemonstratedCode()` returns the last step carrying a
      // code, so this one call is what the chat's demonstration card reads back.
      logStep(`Filed the fare exception as ${code}`, code);
      setFiledCode(code);
      setBookingId(booking.id);
      setNote({
        tone: "neutral",
        text:
          `Fare exception ${code} is filed and approved on ${booking.reference}. ` +
          `Retry the reissue to see whether it now clears.`,
      });
    } finally {
      endRecording();
      setBusy(false);
    }
  };

  const onRetry = async () => {
    if (!option) return;
    setBusy(true);
    setNote(null);
    beginRecording();
    try {
      const outcome = await post(
        `/bookings/${encodeURIComponent(booking.id)}/change`,
        { optionId: option.id },
      );
      if (!outcome.ok) {
        // The DECOY path, and it must read as a real refusal rather than an error
        // state: a catalogued category that does not justify — or a justifying one
        // the booking's record does not support — files fine and lifts nothing.
        // This is the moment the demonstration teaches which half of the catalogue
        // matters, and that the category has to MATCH the record.
        logStep(
          `Re-attempted the reissue on ${booking.reference} — still refused`,
        );
        setNote({ tone: "negative", text: outcome.error });
        return;
      }
      logStep(
        `Reissued ${booking.reference} onto ${option.flightNumber} — the refusal lifted`,
      );
      setFiledCode(null);
      setNote({
        tone: "positive",
        text: `${booking.reference} is reissued onto ${option.flightNumber}.`,
      });
    } finally {
      endRecording();
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 shadow-soft">
      <p className="text-sm text-ink-muted">
        {booking.reference} is ticketed in{" "}
        <span className="font-medium text-ink">{booking.fare.brandLabel}</span>{" "}
        on {flight.flightNumber} {flight.originCity} → {flight.destinationCity}.
        Changes are not permitted on that fare. File a fare exception to have it
        reconsidered.
      </p>

      {/* What this booking's record actually documents, in the prose the
          passenger reads on their own ticket. This is the input to the procedure
          being demonstrated — the category has to MATCH it — and it is
          deliberately free of catalogue vocabulary, which is why it may be on
          screen and in the agent's readables at the same time. */}
      {booking.fareNotes.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-surface-muted p-2.5 text-xs text-ink-muted">
          {booking.fareNotes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Booking
          <select
            aria-label="Booking refused by its fare"
            value={booking.id}
            onChange={(e) => {
              setBookingId(e.target.value);
              setFiledCode(null);
              setNote(null);
            }}
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink"
          >
            {/* The held case is listed too when it has dropped off `cases` — see
                the `selected` comment. Without it the <select> would render a
                value none of its options carry. */}
            {(cases.some((c) => c.booking.id === booking.id)
              ? cases
              : [...cases, active]
            ).map((c) => (
              <option key={c.booking.id} value={c.booking.id}>
                {c.booking.reference} — {c.booking.fare.brandLabel}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Reason for the exception
          <select
            aria-label="Fare exception category"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm font-medium text-ink"
          >
            {FARE_WAIVER_CODES.map((c) => (
              <option key={c} value={c}>
                {FARE_WAIVER_CODE_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Documentation
          <input
            aria-label="Documentation behind the exception"
            value={documentReference}
            onChange={(e) => setDocumentReference(e.target.value)}
            placeholder="Notice or certificate reference"
            className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
          Why
          <input
            aria-label="Fare exception rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="One line for the trip record"
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
          File fare exception
        </button>
        {/* Only offered once an exception is on file for THIS booking. The retry
            is a separate click on purpose: the room has to see the refused write
            re-attempted and either clear or stay refused, which is what makes the
            decoy — and the grounding — legible. */}
        <button
          type="button"
          disabled={busy || !filedForThisBooking || !option}
          onClick={() => void onRetry()}
          className={cn(
            "rounded-md border px-3 py-1.5 text-xs font-medium",
            filedForThisBooking && option
              ? "border-brand/50 bg-brand-soft text-brand-indigo hover:opacity-90 dark:text-brand-violet"
              : "border-hairline text-ink-muted",
            "disabled:opacity-50",
          )}
        >
          {option
            ? `Retry the reissue onto ${option.flightNumber}`
            : "No replacement flight to retry with"}
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

export default FareExceptionForm;
