"use client";

import { useId, useState } from "react";
import {
  readSigningPin,
  signingPinGuidance,
} from "@/skins/keel/data/signing-pin";
import { ChatSurface } from "@/skins/keel/components/chat-surface";

/**
 * BEAT 3a — the e-signature countersignature card. The six digits never leave
 * this component.
 *
 * Releasing a policy revision to the workforce is a SIGNED act: the register
 * records who put that text in front of every employee. So the agent calls
 * `countersignRelease({ document })` — the record and nothing else — and this
 * card POSTs `{ document, pin, personaId }` straight to
 * `/api/keel/v1/countersignatures`. The agent's `respond()` receives ONE
 * sentence, composed below. The digits are never put into `onSigned`, never
 * logged, and never echoed by the route, so the inspector's event stream shows
 * the sentence and nothing else.
 *
 * ⚠️ THE PIN IS A SECOND FACTOR, NEVER AN AUTHORITY OVERRIDE.
 * `/countersignatures` re-runs the SAME `checkReleaseAuthority()` gate as
 * `POST /documents/:id/release`, so a valid PIN on an UNENDORSED revision is
 * refused with the identical `UNENDORSED_REVISION`. THIS CARD MUST NEVER GROW A
 * PATH AROUND THAT: no client-side "release anyway", no second endpoint, no
 * retry that drops the gate. If a PIN could release an unendorsed revision it
 * would be a second door around beat 6's variance gate — the agent would take
 * it, the teach arc would never fire, and nothing would fail. The card would
 * still be gorgeous, the write would still land, and the room would applaud.
 * `countersignatures/route.test.ts` ("BEAT 3a is NOT a way past BEAT 6's gate")
 * pins the server half; `signing-pin-card.test.tsx` pins that this card relays a
 * gate refusal instead of routing around it.
 *
 * ⚠️ PIN VALIDITY IS FORMAT-ONLY. No persona holds a PIN or a digest, so any six
 * digits are accepted — deliberate for a stage demo, where a memorised number is
 * a thing to fumble in front of a room. The beat's claim is about WHERE the
 * value travels, not about authenticating anyone. Both the printed guidance and
 * the submit predicate come from `data/signing-pin.ts`, the same module the
 * route validates with, so the card cannot advertise a format the server then
 * refuses (or refuse one it invited).
 */
export function SigningPinCard({
  documentRef,
  revisionLabel,
  personaId,
  onSigned,
  onDeclined,
}: {
  /** The register's own spelling of the ref, e.g. "STD-045". */
  documentRef: string;
  /**
   * The record's OWN pending revision, read from the ledger by the caller. The
   * agent never names a revision — if it could, it could name an unendorsed one
   * and we would be back to asking the PIN to do the gate's job.
   */
  revisionLabel: string;
  personaId: string;
  onSigned: (message: string) => void;
  onDeclined: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Three states, not a boolean. On success the card normally UNMOUNTS —
  // `respond()` settles the interrupt and the render swaps to its terminal
  // branch — but that is the caller's behaviour, not this component's
  // guarantee. A plain `submitting` flag cleared only on the failure paths
  // would leave the card reading "Signing…" with both buttons dead and nothing
  // on screen explaining it. "signed" is a SETTLED state with its own copy, and
  // it still refuses a second click, so the release cannot be issued twice.
  const [phase, setPhase] = useState<"idle" | "submitting" | "signed">("idle");
  const busy = phase !== "idle";
  const inputId = useId();
  const { hint, length } = signingPinGuidance();

  const submit = async () => {
    // NEVER silently disable the button on an unread value: say why, in the
    // helper's own words. A disabled control with nothing on screen explaining
    // it is the presenter following the card's instruction and the card just
    // sitting there.
    const verdict = readSigningPin(typed);
    if (!verdict.ok) {
      setError(
        "untouched" in verdict
          ? "Enter your e-signature PIN to countersign."
          : verdict.reason,
      );
      return;
    }
    setPhase("submitting");
    try {
      const res = await fetch("/api/keel/v1/countersignatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: documentRef,
          // The one place the digits travel: this request body.
          pin: verdict.pin,
          personaId,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPhase("idle");
        const message =
          typeof body?.message === "string"
            ? body.message
            : "That e-signature PIN was not accepted.";
        setError(message);
        // The refusal goes back to the agent too, VERBATIM and with no
        // suggestion of a way round it. A gate refusal here
        // (`UNENDORSED_REVISION`) is the same refusal the ordinary release route
        // gives, and it must read that way: the agent's next move should be to
        // relay it, never to look for another door.
        onSigned(`The countersignature was refused. ${message}`);
        return;
      }
      setPhase("signed");
      // The only thing the assistant ever learns about this act.
      onSigned(
        `${revisionLabel} of ${documentRef} is released. ` +
          `The e-signature PIN stayed in the card and was never sent to you.`,
      );
    } catch (err) {
      console.error("[keel] countersignature failed:", err);
      setPhase("idle");
      setError("The countersignature could not be sent. Nothing was released.");
    }
  };

  return (
    // Rooted in ChatSurface so the input and buttons stay clickable inside the
    // transcript — see that component for the pointer-events rationale.
    <ChatSurface className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
      <div className="text-sm text-ink">
        Countersign the release of{" "}
        <span className="font-semibold text-brand">{revisionLabel}</span> —{" "}
        <span className="font-mono font-semibold">{documentRef}</span> — to the
        workforce.
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
        aria-label="E-signature PIN"
        onChange={(e) => {
          setTyped(e.target.value);
          setError(null);
        }}
        className="w-32 rounded-md border border-hairline bg-canvas px-3 py-2 font-mono text-sm tracking-widest"
      />
      {error ? <p className="text-xs text-negative">{error}</p> : null}
      {phase === "signed" ? (
        <p className="text-xs text-ink-muted">
          Signed — the release is on the record. This card is finished.
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
            ? "Signing…"
            : phase === "signed"
              ? "Signed"
              : "Countersign"}
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
    </ChatSurface>
  );
}

export default SigningPinCard;
