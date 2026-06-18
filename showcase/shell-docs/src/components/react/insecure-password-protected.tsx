"use client";

import { useState } from "react";

interface InsecurePasswordProtectedProps {
  /**
   * The gate password. Defaults to `NEXT_PUBLIC_LGC_DOCS_PASSWORD` so a
   * deployment can gate everything with one env var, but callers
   * typically pass an explicit per-section password (e.g. early-access
   * betas) so the section is self-contained.
   */
  password?: string;
  children: React.ReactNode;
}

/**
 * Insecure, client-side password gate for early-access / not-yet-public
 * docs content. Ported from the legacy `docs/` site so premium and
 * early-access sections can live in shell-docs unchanged.
 *
 * Intentionally shallow: a single shared password ships in the client
 * bundle, the unlock is cached in `localStorage`, and it is trivially
 * bypassable. The goal is to dissuade casual access to content that is
 * documented but not yet generally available — not to truly secure it
 * (the content is not sensitive). Falls open (renders children) when no
 * password is configured, so local/dev builds without the env var are
 * unaffected.
 */
export function InsecurePasswordProtected({
  password = process.env.NEXT_PUBLIC_LGC_DOCS_PASSWORD,
  children,
}: InsecurePasswordProtectedProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [storedPassword, setStoredPassword] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("storedPassword") || "";
    }
    return "";
  });

  // No password configured → nothing to gate.
  if (!password) {
    return <>{children}</>;
  }

  // Already unlocked this browser.
  if (storedPassword === password) {
    return <>{children}</>;
  }

  const handleSubmit = (): void => {
    if (input === password) {
      setStoredPassword(input);
      setError("");
      if (typeof window !== "undefined") {
        localStorage.setItem("storedPassword", input);
      }
    } else {
      setError("Incorrect password");
      setInput("");
    }
  };

  return (
    <div className="not-prose my-6 flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-6">
      {/* Shallow-by-design notice for anyone reading the source. */}
      <div className="hidden">
        This is a very shallow layer of protection, on purpose — it dissuades
        casual access to not-yet-public content rather than securing it.
      </div>
      <div className="space-y-2 text-center">
        <h3 className="text-lg font-semibold text-[var(--text)]">
          This content is protected by a password.
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          This documents an early-access capability that is not yet publicly
          available. If you’d like access,{" "}
          <a
            href="https://go.copilotkit.ai/earlyaccess"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            apply for early access
          </a>
          . If you’re already in the early-adopter group, enter your password.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="off"
          placeholder="Enter password..."
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text)]"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSubmit();
            }
          }}
          aria-invalid={!!error}
          aria-describedby={error ? "cpk-password-error" : undefined}
        />
        <button
          type="button"
          onClick={handleSubmit}
          className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)]"
        >
          Submit
        </button>
      </div>
      {error && (
        <p id="cpk-password-error" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
