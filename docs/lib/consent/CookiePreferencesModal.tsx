"use client";

import { useEffect, useState } from "react";
import { useConsent } from "./ConsentContext";

const PRIVACY_URL = "https://www.copilotkit.ai/privacy-policy";

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
        checked ? "bg-[#7076D5]" : "bg-foreground/20"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function CookiePreferencesModal() {
  const {
    preferencesOpen,
    closePreferences,
    savePreferences,
    acceptAll,
    rejectAll,
    state,
  } = useConsent();
  const [analytics, setAnalytics] = useState(state.categories.analytics);
  const [marketing, setMarketing] = useState(state.categories.marketing);

  useEffect(() => {
    if (preferencesOpen) {
      setAnalytics(state.categories.analytics);
      setMarketing(state.categories.marketing);
    }
  }, [preferencesOpen, state.categories.analytics, state.categories.marketing]);

  useEffect(() => {
    if (!preferencesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreferences();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preferencesOpen, closePreferences]);

  if (!preferencesOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cookie preferences"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={closePreferences}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-background p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-foreground">Cookie preferences</h2>
        <p className="mt-2 text-sm text-foreground/80">
          Choose which categories of cookies you want to allow. See our{" "}
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[#7076D5]"
          >
            Privacy Policy
          </a>{" "}
          for details.
        </p>

        <ul className="mt-5 space-y-3">
          <li className="rounded-md border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Strictly necessary
                </p>
                <p className="mt-1 text-xs text-foreground/70">
                  Required for the site to function. Always on.
                </p>
              </div>
              <span className="text-xs font-medium text-foreground/70">
                Always on
              </span>
            </div>
          </li>

          <li className="rounded-md border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Analytics</p>
                <p className="mt-1 text-xs text-foreground/70">
                  Helps us understand how the docs are used so we can improve them.
                  Includes Google Analytics, PostHog, and Reo.dev.
                </p>
              </div>
              <Toggle
                checked={analytics}
                onChange={setAnalytics}
                label="Toggle analytics cookies"
              />
            </div>
          </li>

          <li className="rounded-md border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Marketing</p>
                <p className="mt-1 text-xs text-foreground/70">
                  Used to identify business visitors and measure marketing performance.
                  Includes HubSpot, RB2B, and Scarf.
                </p>
              </div>
              <Toggle
                checked={marketing}
                onChange={setMarketing}
                label="Toggle marketing cookies"
              />
            </div>
          </li>
        </ul>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={rejectAll}
            className="rounded-md border border-border bg-transparent px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="rounded-md border border-border bg-transparent px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={() => savePreferences({ analytics, marketing })}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            Save preferences
          </button>
        </div>
      </div>
    </div>
  );
}
