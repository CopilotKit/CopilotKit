"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Cloud } from "lucide-react";

export function AccessGate({
  onAuthenticated = () => window.location.reload(),
  configurationError = false,
}: {
  onAuthenticated?: () => void;
  configurationError?: boolean;
}) {
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState(
    configurationError
      ? "CloudPlot access control is not configured. Contact the operator."
      : "",
  );
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "CloudPlot access was denied.");
        return;
      }
      onAuthenticated();
    } catch {
      setError("CloudPlot could not verify access. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-xl bg-indigo-600 p-2 text-white">
            <Cloud aria-hidden="true" size={24} />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-slate-950">CloudPlot</h1>
            <p className="text-sm text-slate-500">
              AI cloud infrastructure architect
            </p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-slate-700"
              htmlFor="access-code"
            >
              Access code
            </label>
            <input
              id="access-code"
              type="password"
              autoComplete="current-password"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              disabled={configurationError || submitting}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-950 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100"
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={configurationError || submitting || !accessCode}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Verifying…" : "Open CloudPlot"}
          </button>
        </form>
      </section>
    </main>
  );
}
