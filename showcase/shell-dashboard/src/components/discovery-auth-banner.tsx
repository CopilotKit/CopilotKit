import type { StatusRow } from "@/lib/live-status";

interface DiscoveryAuthBannerProps {
  rows: StatusRow[];
}

interface AuthSignal {
  cacheStatus?: "serving-stale" | "no-cache";
  sourceName?: string;
}

interface BrowserPoolSignal {
  errorMessage?: string;
}

function isObjectSignal<T>(s: unknown): s is T {
  return s !== null && typeof s === "object" && !Array.isArray(s);
}

export function DiscoveryAuthBanner({ rows }: DiscoveryAuthBannerProps) {
  const authRow = rows.find(
    (r) => r.key === "system:discovery-auth-failed" && r.state === "red",
  );
  const browserPoolRow = rows.find(
    (r) => r.key === "system:browser-pool-degraded" && r.state === "red",
  );
  if (!authRow && !browserPoolRow) return null;

  let authMessage: string | null = null;
  if (authRow) {
    const signal = isObjectSignal<AuthSignal>(authRow.signal)
      ? authRow.signal
      : null;
    const source = signal?.sourceName ?? "discovery source";
    if (signal?.cacheStatus === "serving-stale") {
      authMessage = `Authentication failed for ${source} — serving stale cached data. Refresh tokens to restore live updates.`;
    } else {
      authMessage = `Authentication failed for ${source} — no cached data available. Discovery results may be incomplete.`;
    }
  }

  let browserPoolMessage: string | null = null;
  if (browserPoolRow) {
    const signal = isObjectSignal<BrowserPoolSignal>(browserPoolRow.signal)
      ? browserPoolRow.signal
      : null;
    const base =
      "Browser pool initialization failed — e2e probes running in degraded mode with stub drivers.";
    browserPoolMessage = signal?.errorMessage
      ? `${base} (${signal.errorMessage})`
      : base;
  }

  return (
    <>
      {authMessage && (
        <div
          role="alert"
          data-testid="discovery-auth-banner"
          className="mx-8 mb-4 flex-shrink-0 rounded-md border border-[var(--danger)] bg-[var(--bg-danger)] px-4 py-2 text-xs text-[var(--danger)]"
        >
          {authMessage}
        </div>
      )}
      {browserPoolMessage && (
        <div
          role="alert"
          data-testid="browser-pool-banner"
          className="mx-8 mb-4 flex-shrink-0 rounded-md border border-[var(--danger)] bg-[var(--bg-danger)] px-4 py-2 text-xs text-[var(--danger)]"
        >
          {browserPoolMessage}
        </div>
      )}
    </>
  );
}
