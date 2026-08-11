"use client";

import { useState } from "react";
import { Database, Lock } from "lucide-react";

const WAREHOUSES = ["Snowflake", "BigQuery", "Databricks", "Redshift"];

/**
 * Beat 3a. The credential is typed HERE, in the chat, and goes straight to
 * `POST /api/vantage/v1/sources`. It is never put into a tool argument, a
 * message, or the value handed back to the agent — whose `respond()` receives
 * only "Connected to <name> — <n> tables."
 *
 * Do not add the token to any callback payload that reaches the transcript. That
 * single change would silently invalidate the beat this card exists to prove.
 */
export function SourceConnectCard({
  status,
  result,
  onConnect,
  onCancel,
}: {
  status: "asking" | "connected" | "declined";
  result?: string;
  onConnect: (input: {
    name: string;
    warehouse: string;
    token: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("FINANCE_PROD");
  const [warehouse, setWarehouse] = useState(WAREHOUSES[0]);
  const [token, setToken] = useState("");

  if (status !== "asking") {
    return (
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-[var(--radius)] border border-hairline bg-surface p-3.5 text-sm">
        <Database
          className={
            status === "connected"
              ? "h-4 w-4 text-positive"
              : "h-4 w-4 text-ink-muted"
          }
        />
        <span className="text-ink">
          {result ??
            (status === "connected"
              ? "Warehouse connected."
              : "Not connected.")}
        </span>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-ink">Connect a warehouse</h3>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Source name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-[var(--radius)] border border-hairline bg-surface-muted px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Warehouse
          </span>
          <select
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            className="rounded-[var(--radius)] border border-hairline bg-surface-muted px-2 py-1.5 text-xs text-ink"
          >
            {WAREHOUSES.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          <Lock className="h-3 w-3" />
          Access token
        </span>
        <input
          type="password"
          value={token}
          autoComplete="off"
          placeholder="Paste the warehouse credential"
          onChange={(e) => setToken(e.target.value)}
          className="rounded-[var(--radius)] border border-hairline bg-surface-muted px-2 py-1.5 font-mono text-xs text-ink"
        />
        <span className="text-[10px] text-ink-muted">
          Sent straight to Vantage. Never shown to the assistant.
        </span>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={token.trim().length < 12 || !name.trim()}
          onClick={() => onConnect({ name: name.trim(), warehouse, token })}
          className="rounded-[var(--radius)] bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition-opacity disabled:opacity-40"
        >
          Connect
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--radius)] border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
