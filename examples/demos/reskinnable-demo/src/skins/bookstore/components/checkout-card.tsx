"use client";

import { useState } from "react";
import { formatUsd } from "@/skins/bookstore/data/query";

/**
 * Beat 3a. The shopper types their card HERE, in the chat, and the only datum
 * that ever leaves this component is `last4`.
 *
 * The security claim in one sentence: the agent initiates checkout, never asks
 * for the digits, and receives back `"Order #1042 placed — 2 items, $34.50
 * (•••• 4242)."` The full number, the expiry and the CVV live in this
 * component's local state and are never lifted, never returned through
 * `respond()`, never persisted, and never put in the DOM as text.
 * `checkout-card.test.tsx` asserts all of that, because it is the kind of claim
 * that a well-meaning refactor breaks silently.
 *
 * There is NO payment processor and no tokenization. This is a demo surface, and
 * the plan says so rather than implying otherwise.
 *
 * TWO MODES, and the second one is beat 2:
 *  - `form` — the live call, while the shopper is answering.
 *  - `receipt` — re-derived from the REPLAYED tool result when the thread is
 *    reopened. Without it, an answered card falls back to a blank form on reload,
 *    which is exactly the moment the durable-thread beat is being demonstrated.
 */

const DIGITS = /^\d+$/;
const EXPIRY = /^(0[1-9]|1[0-2])\/\d{2}$/;

export type CheckoutCardProps =
  | {
      mode: "form";
      itemCount: number;
      totalCents: number;
      /** Receives ONLY the last four digits. Never the number, expiry or CVV. */
      onSubmit: (last4: string) => void;
      onCancel?: () => void;
    }
  | {
      mode: "receipt";
      orderId: string;
      itemCount: number;
      totalCents: number;
      last4: string;
    };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-hairline bg-surface p-3.5 text-sm">
      {children}
    </div>
  );
}

export function CheckoutCard(props: CheckoutCardProps) {
  if (props.mode === "receipt") {
    return (
      <Shell>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-ink">Order #{props.orderId}</div>
            <div className="text-xs text-ink-muted">
              {props.itemCount} {props.itemCount === 1 ? "item" : "items"} ·
              •••• {props.last4}
            </div>
          </div>
          <div className="bookstore-display text-lg font-bold text-ink">
            {formatUsd(props.totalCents)}
          </div>
        </div>
        <div className="mt-2 text-xs font-medium text-positive">Paid</div>
      </Shell>
    );
  }

  return <CheckoutForm {...props} />;
}

function CheckoutForm({
  itemCount,
  totalCents,
  onSubmit,
  onCancel,
}: Extract<CheckoutCardProps, { mode: "form" }>) {
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Guards double submission: a HITL `respond()` called twice fails the thread
  // with "Tool result is missing for tool call", which ends the demo.
  const [submitted, setSubmitted] = useState(false);

  const submit = () => {
    if (submitted) return;

    // Deliberately shallow: length and shape only. No Luhn check and no
    // processor — this is a demo surface, and a stricter validator would just
    // reject the fake card the presenter types.
    const bare = number.replace(/[\s-]/g, "");
    if (bare.length !== 16 || !DIGITS.test(bare)) {
      setError("Card number should be 16 digits.");
      return;
    }
    if (!EXPIRY.test(expiry)) {
      setError("Expiry should look like 12/29.");
      return;
    }
    if (cvv.length < 3 || cvv.length > 4 || !DIGITS.test(cvv)) {
      setError("Security code should be 3 or 4 digits.");
      return;
    }

    setError(null);
    setSubmitted(true);

    // THE boundary. Compute last4, then drop every other digit from state so the
    // component cannot hold the number a moment longer than it needs to.
    const last4 = bare.slice(-4);
    setNumber("");
    setExpiry("");
    setCvv("");
    onSubmit(last4);
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { type?: string; placeholder: string; maxLength?: number },
  ) => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <input
        // password, not text: this card is on a projector. The presenter typing a
        // number the room can read undercuts the exact point being made.
        type={opts.type ?? "text"}
        inputMode="numeric"
        autoComplete="off"
        placeholder={opts.placeholder}
        maxLength={opts.maxLength}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="rounded-md border border-hairline bg-canvas px-2 py-1.5 text-sm text-ink"
      />
    </label>
  );

  return (
    <Shell>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-semibold text-ink">
          Pay for {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
        <span className="bookstore-display text-lg font-bold text-ink">
          {formatUsd(totalCents)}
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {field("Card number", number, setNumber, {
          type: "password",
          placeholder: "•••• •••• •••• ••••",
          maxLength: 19,
        })}
        <div className="grid grid-cols-2 gap-2.5">
          {field("Expiry", expiry, setExpiry, {
            placeholder: "MM/YY",
            maxLength: 5,
          })}
          {field("Security code", cvv, setCvv, {
            type: "password",
            placeholder: "•••",
            maxLength: 4,
          })}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-negative">
          {error}
        </p>
      ) : null}

      <p className="mt-2.5 text-[11px] leading-snug text-ink-muted">
        Your card details stay in this form. The assistant only ever sees the
        last four digits.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitted}
          className="rounded-md bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          Pay {formatUsd(totalCents)}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitted}
            className="text-xs text-ink-muted underline hover:text-ink"
          >
            Not now
          </button>
        ) : null}
      </div>
    </Shell>
  );
}
