"use client";

import { useMemo, useRef, useState } from "react";
import { Check, CreditCard as CardIcon, ShieldCheck } from "lucide-react";

import type { Card } from "@/app/api/v1/data";
import { cn } from "@/lib/utils";

const PIN_LENGTH = 4;

/**
 * The resolved state of a PIN change, as generative UI rather than a line of
 * text.
 *
 * Two reasons it is a component and not "New PIN saved.":
 *  - Reloading a thread replays persisted tool results, so a text-only outcome
 *    comes back as a bare sentence with no sense of what happened. A card
 *    re-renders with the same weight it had live.
 *  - It keeps the product promise consistent — the chat answers in UI, not
 *    prose — which is what we want customers to expect from an agent surface.
 *
 * It renders from the tool RESULT (card brand/last4 parsed out of it), not from
 * component state, precisely so a rehydrated thread shows the same card.
 *
 * The digits are never displayed. They were never sent to the agent, so they are
 * not in the result to display — the mask is the honest representation.
 */
export function PinChangedCard({
  brand,
  last4,
  failed,
  cancelled,
}: {
  brand?: string;
  last4?: string;
  failed?: string;
  cancelled?: boolean;
}) {
  // Cancelling is a normal outcome, not an error, so it stays neutral — red
  // here would read as "something went wrong" for a deliberate choice.
  if (cancelled) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
        PIN change cancelled.
      </div>
    );
  }

  if (failed) {
    return (
      <div className="rounded-2xl border border-negative/30 bg-negative-soft/40 p-4 text-sm text-ink shadow-soft">
        <p className="font-medium text-negative">PIN not changed</p>
        <p className="mt-0.5 text-xs text-ink-muted">{failed}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="chat-pin-changed"
      className="space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-positive-soft text-positive">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        </span>
        <h3 className="text-sm font-semibold text-ink">PIN updated</h3>
      </div>

      {/* A miniature of the card face, so the confirmation is recognisably
          about a specific card rather than a generic success message. */}
      <div className="brand-gradient relative overflow-hidden rounded-xl p-3 text-surface">
        <div className="flex items-start justify-between">
          <span className="h-5 w-7 rounded bg-amber-300/90" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide opacity-90">
            {brand ?? "Card"}
          </span>
        </div>
        <p className="mt-3 font-mono text-sm tracking-[0.2em]">
          ••••&nbsp;&nbsp;••••&nbsp;&nbsp;••••&nbsp;&nbsp;{last4 ?? "••••"}
        </p>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <p className="text-[0.55rem] uppercase tracking-wide opacity-75">
              New PIN
            </p>
            <p className="font-mono text-sm tracking-[0.3em]">••••</p>
          </div>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[0.6rem] font-medium">
            Active now
          </span>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        Set on your screen and applied immediately. The PIN was never sent to the
        assistant.
      </p>
    </div>
  );
}

/**
 * PIN entry, rendered INSIDE the chat by the `setCardPin` human-in-the-loop
 * tool. The officer picks a card and types the digits here; the agent never
 * asks for them and never receives them, so the PIN stays out of the transcript
 * and out of the model's context.
 *
 * Four separate single-digit boxes rather than one text field: it reads as a PIN
 * pad, auto-advances, and makes "4 digits" a property of the UI instead of a
 * validation message. Digits are masked once entered, and confirmation is
 * blocked until all four are present, so the error state is unreachable rather
 * than merely handled.
 */
export function PinChangeCard({
  cards,
  initialCardId,
  onSubmit,
  onCancel,
}: {
  cards: Card[];
  initialCardId?: string;
  onSubmit: (cardId: string, pin: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [cardId, setCardId] = useState<string>(
    initialCardId && cards.some((c) => c.id === initialCardId)
      ? initialCardId
      : (cards[0]?.id ?? ""),
  );
  const [digits, setDigits] = useState<string[]>(
    Array.from({ length: PIN_LENGTH }, () => ""),
  );
  const [submitting, setSubmitting] = useState(false);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const pin = digits.join("");
  const complete = pin.length === PIN_LENGTH;
  const selected = useMemo(
    () => cards.find((c) => c.id === cardId),
    [cards, cardId],
  );

  const setDigit = (index: number, raw: string) => {
    const value = raw.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (value && index < PIN_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, key: string) => {
    // Backspace on an empty box steps back, so correcting a typo never needs
    // the mouse.
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const submit = async () => {
    if (!complete || !cardId || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(cardId, pin);
    } finally {
      setDigits(Array.from({ length: PIN_LENGTH }, () => ""));
      setSubmitting(false);
    }
  };

  if (!cards.length) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted shadow-soft">
        No cards available to update.
      </div>
    );
  }

  return (
    <div
      data-testid="chat-pin-change"
      className="pointer-events-auto space-y-4 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft"
    >
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-ink">Set a new PIN</h3>
        <p className="text-xs leading-relaxed text-ink-muted">
          Type it here — it stays on your screen and is never sent to the
          assistant.
        </p>
      </div>

      {/* Card picker. Radio semantics so arrow keys work and the choice is
          announced; only shown when there is a real choice to make. */}
      {cards.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Choose a card"
          className="flex flex-col gap-1.5"
        >
          {cards.map((card) => {
            const active = card.id === cardId;
            return (
              <button
                key={card.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCardId(card.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  active
                    ? "border-brand/50 bg-brand-soft text-brand-indigo dark:text-brand-violet"
                    : "border-hairline bg-surface text-ink hover:bg-surface-muted",
                )}
              >
                <CardIcon className="h-4 w-4 flex-none" aria-hidden />
                <span className="flex-1 truncate">
                  {card.type} ending {card.last4}
                </span>
                {active && <Check className="h-4 w-4 flex-none" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <label
          className="block text-xs font-medium text-ink-muted"
          htmlFor="chat-pin-0"
        >
          New 4-digit PIN
          {cards.length === 1 && selected
            ? ` · ${selected.type} ending ${selected.last4}`
            : ""}
        </label>
        <div className="flex gap-2">
          {digits.map((digit, index) => (
            <input
              key={index}
              id={`chat-pin-${index}`}
              ref={(el) => {
                inputsRef.current[index] = el;
              }}
              // `password` masks the digit; inputMode numeric brings up the
              // number pad on touch.
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={1}
              aria-label={`PIN digit ${index + 1} of ${PIN_LENGTH}`}
              value={digit}
              onChange={(e) => setDigit(index, e.target.value)}
              onKeyDown={(e) => onKeyDown(index, e.key)}
              className="h-11 w-11 rounded-xl border border-hairline bg-surface text-center text-lg font-semibold text-ink shadow-inner transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="chat-pin-submit"
          onClick={() => void submit()}
          disabled={!complete || submitting}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            complete && !submitting
              ? "brand-gradient text-surface"
              : "cursor-not-allowed bg-surface-muted text-ink-muted",
          )}
        >
          {submitting ? "Updating…" : "Update PIN"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default PinChangeCard;
