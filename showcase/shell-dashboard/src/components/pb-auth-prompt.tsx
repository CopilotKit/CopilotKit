"use client";

import { useState, type FormEvent } from "react";
import { pb } from "@/lib/pb";

export interface PbAuthPromptProps {
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Modal login prompt for PocketBase admin authentication.
 * Used when entering edit mode on the Baseline tab.
 *
 * Tries PB 0.22+ `_superusers` collection first, then falls back
 * to the legacy `pb.admins` API (PB 0.21).
 */
export function PbAuthPrompt({ onSuccess, onCancel }: PbAuthPromptProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // PB 0.22+ uses a _superusers collection for admin auth
      await pb
        .collection("_superusers")
        .authWithPassword(email.trim(), password);
      onSuccess();
      return;
    } catch {
      // Fall through to legacy API
    }

    try {
      // PB 0.21 legacy admin auth
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (pb as any).admins.authWithPassword(email.trim(), password);
      onSuccess();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Authentication failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    /* Full-screen backdrop */
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={onCancel}
      role="presentation"
    >
      {/* Modal card — stop click propagation so clicking inside doesn't cancel */}
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-80 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow"
      >
        {/* Title */}
        <h2 className="text-sm font-semibold text-[var(--text)]">
          PocketBase Login
        </h2>

        {/* Subtitle */}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Admin credentials required to edit baseline data.
        </p>

        {/* Error display */}
        {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}

        {/* Email input */}
        <label className="mt-4 block">
          <span className="text-xs text-[var(--text-muted)]">Email</span>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
            placeholder="admin@example.com"
          />
        </label>

        {/* Password input */}
        <label className="mt-3 block">
          <span className="text-xs text-[var(--text-muted)]">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        {/* Action buttons */}
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="cursor-pointer rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Logging in…" : "Login"}
          </button>
        </div>
      </form>
    </div>
  );
}
