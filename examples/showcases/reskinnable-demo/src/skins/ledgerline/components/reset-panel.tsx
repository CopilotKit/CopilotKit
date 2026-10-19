"use client";

import { useState } from "react";
import { Check, CheckCircle2, CircleAlert, Copy, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { primaryButton, secondaryButton } from "./ui";

/**
 * Presenter reset, in two steps shown in one panel:
 *
 *   1. `POST /api/ledgerline/v1/dev/reset` restores the seeded expense ledger,
 *      then `POST /api/learning/v1/reset` clears today's captured trajectories,
 *      insights, skills and eval candidates.
 *   2. `POST /api/ledgerline/v1/dev/tunnel` keeps the public tunnel ChatGPT uses if
 *      it still answers, or starts a new one (a slept laptop has usually lost
 *      it) and says so, because a new tunnel means a new URL in ChatGPT.
 *
 * Done reloads the app so every page and the chat start from the seed.
 */

type Step<T> =
  | { state: "pending" }
  | { state: "ok"; text: string; detail?: T }
  | { state: "warn"; text: string }
  | { state: "error"; text: string };

interface TunnelDetail {
  mcpUrl: string;
  changed: boolean;
}

interface ResetRun {
  data: Step<never>;
  tunnel: Step<TunnelDetail> | { state: "skipped" };
  /** Whether the store was reset, so Done must reload. */
  resetHappened: boolean;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

async function resetData(): Promise<{
  step: Step<never>;
  resetHappened: boolean;
}> {
  try {
    const ledger = await fetch("/api/ledgerline/v1/dev/reset", {
      method: "POST",
    });
    if (!ledger.ok) {
      const body = await readJson(ledger);
      return {
        step: {
          state: "error",
          text: `The demo was NOT reset (HTTP ${ledger.status}). ${String(body.message ?? "")}`.trim(),
        },
        resetHappened: false,
      };
    }
    const learning = await fetch("/api/learning/v1/reset", { method: "POST" });
    if (!learning.ok) {
      return {
        step: {
          state: "warn",
          text: `Expense reports restored, but the learning reset failed (HTTP ${learning.status}). Run Reset again.`,
        },
        resetHappened: true,
      };
    }
  } catch (err) {
    return {
      step: {
        state: "warn",
        text: `Reset could not be confirmed (${String(err)}). Done reloads the app.`,
      },
      resetHappened: true,
    };
  }
  return {
    step: {
      state: "ok",
      text: "Seeded expense reports restored. Today's trajectories, insights, skills and eval candidates cleared.",
    },
    resetHappened: true,
  };
}

async function ensureTunnel(): Promise<Step<TunnelDetail>> {
  let res: Response;
  try {
    res = await fetch("/api/ledgerline/v1/dev/tunnel", { method: "POST" });
  } catch (err) {
    return {
      state: "error",
      text: `Could not reach the server to check the tunnel (${String(err)}).`,
    };
  }
  const body = await readJson(res);
  if (!res.ok || typeof body.mcpUrl !== "string") {
    return {
      state: "error",
      text: String(
        body.message ?? `The tunnel check failed (HTTP ${res.status}).`,
      ),
    };
  }
  return {
    state: "ok",
    text: "Tunnel live",
    detail: { mcpUrl: body.mcpUrl, changed: body.changed === true },
  };
}

export function useLedgerlineReset(navigate: () => void) {
  const [run, setRun] = useState<ResetRun | null>(null);

  const start = async () => {
    if (
      !window.confirm(
        "Reset the demo? This restores the seeded expense reports and clears what Automatic Learning captured today.",
      )
    ) {
      return;
    }
    setRun({
      data: { state: "pending" },
      tunnel: { state: "pending" },
      resetHappened: false,
    });
    const data = await resetData();
    if (!data.resetHappened) {
      setRun({
        data: data.step,
        tunnel: { state: "skipped" },
        resetHappened: false,
      });
      return;
    }
    setRun({
      data: data.step,
      tunnel: { state: "pending" },
      resetHappened: true,
    });
    const tunnel = await ensureTunnel();
    setRun({ data: data.step, tunnel, resetHappened: true });
  };

  const close = () => {
    if (run?.resetHappened) navigate();
    setRun(null);
  };

  const panel = run ? <ResetPanel run={run} onDone={close} /> : null;
  return { start, panel };
}

function StepIcon({ state }: { state: string }) {
  if (state === "pending")
    return (
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand" />
    );
  if (state === "ok")
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" />;
  return <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-negative" />;
}

function ResetPanel({ run, onDone }: { run: ResetRun; onDone: () => void }) {
  const tunnel = run.tunnel;
  return (
    <div
      data-no-record=""
      className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(30_10%_8%/0.35)] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDone();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledgerline-reset-title"
        data-testid="ledgerline-reset-panel"
        className="w-full max-w-md overflow-hidden rounded-[10px] border border-hairline bg-surface text-ink shadow-lift"
      >
        <div className="border-b border-hairline px-5 pb-3 pt-4">
          <h2
            id="ledgerline-reset-title"
            className="text-[0.98rem] font-semibold"
          >
            Demo reset
          </h2>
        </div>

        <div className="space-y-4 px-5 py-4 text-[0.82rem]">
          <section
            className="flex items-start gap-2.5"
            data-testid="ledgerline-reset-data"
          >
            <StepIcon state={run.data.state} />
            <div className="min-w-0">
              <div className="font-medium">Demo data</div>
              <p
                className={cn(
                  "text-ink-muted",
                  run.data.state === "error" && "text-negative",
                )}
              >
                {run.data.state === "pending"
                  ? "Restoring the seeded reports..."
                  : run.data.text}
              </p>
            </div>
          </section>

          {tunnel.state === "skipped" ? null : (
            <section
              className="flex items-start gap-2.5"
              data-testid="ledgerline-reset-tunnel"
            >
              <StepIcon state={tunnel.state} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  ChatGPT tunnel
                  {tunnel.state === "ok" ? (
                    <span
                      data-testid="ledgerline-tunnel-live"
                      className="rounded-full bg-positive-soft px-2 py-0.5 text-[0.66rem] font-semibold text-positive"
                    >
                      Tunnel live
                    </span>
                  ) : null}
                </div>
                {tunnel.state === "pending" ? (
                  <p className="text-ink-muted">
                    Checking the public tunnel. Starting a new one can take up
                    to a minute.
                  </p>
                ) : tunnel.state === "ok" && tunnel.detail ? (
                  <TunnelResult detail={tunnel.detail} />
                ) : tunnel.state === "ok" ? null : (
                  <p
                    role="alert"
                    className="text-negative"
                    data-testid="ledgerline-tunnel-error"
                  >
                    Tunnel is down. {tunnel.text}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="flex justify-end border-t border-hairline px-5 py-3">
          <button
            type="button"
            onClick={onDone}
            className={
              tunnel.state === "pending" ? secondaryButton : primaryButton
            }
          >
            {tunnel.state === "pending" ? "Close" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TunnelResult({ detail }: { detail: TunnelDetail }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail.mcpUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mt-1.5 space-y-2">
      <div className="text-[0.72rem] text-ink-muted">MCP server URL</div>
      <div className="flex items-center gap-2">
        <code
          data-testid="ledgerline-tunnel-url"
          className="min-w-0 flex-1 select-all break-all rounded-lg border border-hairline bg-surface-muted px-2.5 py-1.5 font-mono text-[0.72rem]"
        >
          {detail.mcpUrl}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy the MCP URL"
          className={cn(secondaryButton, "shrink-0 px-3 py-1.5 text-[0.76rem]")}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-positive" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {detail.changed ? (
        <p
          data-testid="ledgerline-tunnel-changed"
          className="rounded-lg border border-brand-violet/30 bg-[hsl(20_100%_96%)] px-2.5 py-2 text-[0.76rem] font-medium text-ink"
        >
          New address: re-add the Ledgerline app in ChatGPT with this URL.
        </p>
      ) : (
        <p
          className="text-[0.74rem] text-ink-muted"
          data-testid="ledgerline-tunnel-same"
        >
          Same address as before. Nothing to change in ChatGPT.
        </p>
      )}
    </div>
  );
}
