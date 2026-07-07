"use client";

// EarlyAccessGate — client-side soft gate for early-access docs.
//
// Renders the gated page content blurred and non-interactive with an
// unlock card floating above it. The card lives in a sticky,
// viewport-height frame inside an absolute overlay, so it stays
// centered in view while the blurred page scrolls underneath — without
// covering the sidebar or top nav the way a true fixed modal would.
//
// Unlock state persists in localStorage (per gate id), so entering the
// password once unlocks every page behind the same gate.

import React, { useEffect, useId, useState } from "react";
import Image from "next/image";
import { Lock } from "lucide-react";
import { getEarlyAccessGate } from "@/lib/early-access";
import type { EarlyAccessGateConfig } from "@/lib/early-access";

const UNLOCKED_VALUE = "unlocked";

function readUnlocked(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === UNLOCKED_VALUE;
  } catch {
    // Storage unavailable (private mode, blocked) — treat as locked;
    // a correct password still unlocks for the current page view.
    return false;
  }
}

function persistUnlocked(storageKey: string): void {
  try {
    window.localStorage.setItem(storageKey, UNLOCKED_VALUE);
  } catch {
    // Best effort — the in-memory unlock still applies.
  }
}

export function EarlyAccessGate({
  gate,
  children,
}: {
  gate: string;
  children: React.ReactNode;
}) {
  const config = getEarlyAccessGate(gate);
  if (!config) return <>{children}</>;
  return <GateShell config={config}>{children}</GateShell>;
}

function GateShell({
  config,
  children,
}: {
  config: EarlyAccessGateConfig;
  children: React.ReactNode;
}) {
  // null = not yet hydrated. The server (and first client render)
  // always paint the locked state so hydration matches; the effect
  // then either reveals the content or pops the unlock card in.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);

  useEffect(() => {
    setUnlocked(readUnlocked(config.storageKey));
  }, [config.storageKey]);

  const locked = unlocked !== true;

  return (
    <div className="relative">
      <div
        inert={locked}
        aria-hidden={locked}
        className={`transition-[filter,opacity] duration-500 ease-out ${
          locked
            ? "pointer-events-none min-h-[75svh] select-none opacity-60 blur-[14px]"
            : ""
        }`}
      >
        {children}
      </div>
      {unlocked === false && (
        <div className="pointer-events-none absolute inset-0 z-10">
          {/* Sticky scrollport-height frame: pins to the top of the
              docs scroll container while the gated region scrolls,
              keeping the card centered in view the whole way down. The
              height subtracts the fixed nav + banner so the frame (and
              the card's max-height) tracks the visible content area. */}
          <div className="sticky top-0 flex h-[calc(100svh-var(--fd-nav-height,64px)-var(--fd-banner-height,0px))] items-center justify-center px-4 sm:px-6">
            <UnlockCard
              config={config}
              onUnlock={() => {
                persistUnlocked(config.storageKey);
                setUnlocked(true);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function UnlockCard({
  config,
  onUnlock,
}: {
  config: EarlyAccessGateConfig;
  onUnlock: () => void;
}) {
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim() === config.password) {
      onUnlock();
    } else {
      setError(true);
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className="pointer-events-auto max-h-[calc(100%-2rem)] w-full max-w-[820px] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-modal)]"
    >
      <div className="flex items-center gap-4 p-6">
        <div
          className="flex size-[52px] shrink-0 items-center justify-center rounded-xl bg-[var(--accent-dim)] text-[var(--foreground)]"
          aria-hidden="true"
        >
          <Lock className="size-[26px]" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-accent)]">
            {config.eyebrow}
          </div>
          <h2
            id={titleId}
            className="mt-1 text-xl font-bold leading-snug tracking-tight text-[var(--foreground)] md:text-[23px]"
          >
            {config.title}
          </h2>
        </div>
      </div>

      <div className="@container border-t border-[var(--border)] p-6">
        {/* Two columns once the CARD itself is wide enough (container
            query, not viewport — at tablet widths the sidebar leaves
            the card too narrow to split). Copy + form on the left,
            product preview on the right; on narrow cards the preview
            is hidden so the form needs no internal scrolling. The
            preview column stretches to exactly the height of the copy
            column (default align-items, fill + object-cover image). */}
        <div className="flex flex-col gap-5 @3xl:flex-row @3xl:gap-6">
          <div className="min-w-0 flex-1">
            {config.description.map((paragraph, index) => (
              <p
                key={paragraph}
                className={`text-[15px] leading-relaxed text-[var(--muted-foreground)] ${
                  index > 0 ? "mt-3" : ""
                }`}
              >
                {paragraph}
              </p>
            ))}

            <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted-foreground)]">
              {config.requestPrompt}{" "}
              <a
                href={config.requestUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[var(--brand-accent)] underline decoration-[color-mix(in_oklch,var(--brand-accent)_40%,transparent)] underline-offset-[3px] transition-colors hover:decoration-[var(--brand-accent)]"
              >
                {config.requestLinkLabel}
              </a>
              .
            </p>

            <form onSubmit={handleSubmit} className="mt-5" noValidate>
              <label
                htmlFor={inputId}
                className="block text-sm font-semibold text-[var(--foreground)]"
              >
                Password
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Lock
                    className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]"
                    aria-hidden="true"
                  />
                  <input
                    id={inputId}
                    type="password"
                    value={value}
                    onChange={(event) => {
                      setValue(event.target.value);
                      if (error) setError(false);
                    }}
                    placeholder="Enter password"
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    aria-invalid={error || undefined}
                    aria-describedby={error ? errorId : undefined}
                    className={`h-12 w-full rounded-xl border bg-[var(--background)] pl-10 pr-3.5 text-[15px] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:ring-2 ${
                      error
                        ? "border-[var(--destructive)] focus:border-[var(--destructive)] focus:ring-[color-mix(in_oklch,var(--destructive)_20%,transparent)]"
                        : "border-[var(--border)] focus:border-[var(--brand-accent)] focus:ring-[var(--accent-dim)]"
                    }`}
                  />
                </div>
                <button
                  type="submit"
                  className="h-12 shrink-0 cursor-pointer rounded-xl bg-[var(--brand-accent)] px-6 text-[15px] font-semibold text-[var(--brand-accent-foreground)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]"
                >
                  Unlock
                </button>
              </div>
              {error && (
                <p
                  id={errorId}
                  role="alert"
                  className="mt-2.5 text-[13px] font-medium text-[var(--destructive)]"
                >
                  That password didn&apos;t work — double-check it and try
                  again.
                </p>
              )}
            </form>
          </div>

          {config.image && (
            <div className="relative hidden overflow-hidden rounded-xl border border-[var(--border)] shadow-[var(--shadow-control)] @3xl:block @3xl:w-[300px] @3xl:shrink-0">
              {/* Theme-paired variants, mirroring the docs' diagram
                  pattern — the light image renders `dark:hidden`, the
                  dark one `dark:block`. */}
              {/* `object-contain` keeps the screenshot uncropped while
                  the stretched container tracks the copy column's
                  height; each img's background matches its variant's
                  own canvas color so the letterboxed area blends in
                  and the content keeps even padding on every side. */}
              <Image
                src={config.image.lightSrc}
                alt={config.image.alt}
                fill
                sizes="300px"
                className="bg-[var(--card)] object-contain dark:hidden"
              />
              <Image
                src={config.image.darkSrc}
                alt={config.image.alt}
                fill
                sizes="300px"
                className="hidden bg-[var(--card)] object-contain dark:block"
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
