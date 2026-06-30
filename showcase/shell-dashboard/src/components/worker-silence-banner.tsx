"use client";
/**
 * Coverage-tab worker-family silence banner (spec §7.4) — the one-glance
 * answer the motivating incident lacked, reusing the `DiscoveryAuthBanner`
 * slot pattern (mx-8 alert strip above the tab content).
 *
 * Behaviors (all §7.4):
 *  - Amber banner when any worker family's `lastSuccessAt` is older than
 *    2 schedule periods. The period is the SERVER-computed `periodMs` each
 *    §5.2.1 family entry carries (resolved-cron derived, so a d6
 *    `FLEET_PRODUCER_CRON` override scales the window) — never a client-
 *    parsed cron and never a hardcoded constant. The classification is
 *    `isFamilySilent` (worker-runs-context), shared with the §7.3 glyph.
 *  - Null `lastSuccessAt` follows the §5.2.1 fallback: never-succeeded
 *    families banner once their oldest known batch's `enqueuedAt` crosses
 *    the threshold; zero-batch families stay quiet (fresh env).
 *  - When `WorkerRunsContext` reports `unavailable`, the banner does NOT
 *    vanish for lack of family data — it shows the unreachable variant
 *    instead. A 404 arrives as `unavailable` per §6.1's source-constant
 *    rule (cold first poll and post-success alike) and renders this same
 *    variant; there is no suppressing state.
 *  - Dismissible: dismissal is keyed to the banner's content identity
 *    (variant + silent family set), so a newly-silent family or a variant
 *    flip re-surfaces a previously dismissed banner.
 *
 * No-data (`null` context — no provider mounted or first poll unsettled)
 * renders nothing, per the T10 no-provider contract.
 */
import { useState } from "react";

import type { WorkerFamilySummary } from "@/lib/ops-api";
import {
  freshestBounceMs,
  isFamilySilent,
  useWorkerRuns,
} from "@/lib/worker-runs-context";
import { formatRelative } from "./status-table";

/**
 * The §5.2.1 staleness reference time for a silent family — mirrors the
 * fallback chain inside `isFamilySilent` (T10 owns that module; this
 * banner only formats the same reference for display): `lastSuccessAt`,
 * else the oldest known batch's `enqueuedAt` (`lastRun` is older than
 * `inflight` by construction — inflight is the newest group).
 */
function silenceReference(entry: WorkerFamilySummary): string | null {
  return (
    entry.lastSuccessAt ??
    entry.lastRun?.enqueuedAt ??
    entry.inflight?.enqueuedAt ??
    null
  );
}

const VARIANT_CLASSES = {
  // Amber: family silence is the §7 staleness incident class.
  silence: "border-[var(--amber)] text-[var(--amber)]",
  // Danger: the telemetry itself is down (§6.1 incident class) — the
  // dashboard must not look healthy, mirroring DiscoveryAuthBanner.
  unreachable:
    "border-[var(--danger)] bg-[var(--bg-danger)] text-[var(--danger)]",
} as const;

export function WorkerSilenceBanner() {
  const status = useWorkerRuns();
  // Content-identity key of the dismissed banner; the banner stays hidden
  // only while its identity is unchanged (see module header).
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  if (status === null) return null;

  const nowMs = Date.now();
  let variant: keyof typeof VARIANT_CLASSES;
  let contentKey: string;
  let messages: string[];

  if (status.status === "unavailable") {
    variant = "unreachable";
    contentKey = "unreachable";
    const lastGood = status.lastGood;
    messages = [
      lastGood
        ? `Worker run telemetry unreachable — ops endpoint not responding (last good ${formatRelative(lastGood.fetchedAt, nowMs)}); see Ops tab.`
        : "Worker run telemetry unreachable — ops endpoint not responding; see Ops tab.",
    ];
  } else {
    // Post-bounce drain grace: a recent fleet bounce (PR #5715) suppresses
    // both this banner and the §9 Slack alert via the SAME 2×period grace
    // term, keyed off the same worker `registeredAt` shipped in the strip.
    // (Only the grace term is shared — the banner's silence ONSET is 2×period
    // vs. the pager's 3×period + 3-tick debounce, an intentional asymmetry.)
    const bounceAtMs = freshestBounceMs(status.data.workers);
    const silentFamilies = status.data.families.filter((family) =>
      isFamilySilent(family, nowMs, bounceAtMs),
    );
    if (silentFamilies.length === 0) return null;
    variant = "silence";
    contentKey = `silence:${silentFamilies
      .map((family) => family.family)
      .sort()
      .join(",")}`;
    messages = silentFamilies.map((family) => {
      const reference = silenceReference(family);
      // `isFamilySilent` only classifies silent off a parseable reference,
      // so this is always present here; "—" is unreachable defensive copy.
      const since =
        reference !== null ? formatRelative(Date.parse(reference), nowMs) : "—";
      return `Worker family ${family.label} has not completed successfully since ${since} — see Ops tab.`;
    });
  }

  if (dismissedKey === contentKey) return null;

  return (
    <div
      role="alert"
      data-testid="worker-silence-banner"
      data-variant={variant}
      className={`mx-8 mb-4 flex flex-shrink-0 items-start gap-3 rounded-md border px-4 py-2 text-xs ${VARIANT_CLASSES[variant]}`}
    >
      <div className="flex-1">
        {messages.map((message) => (
          <div key={message}>{message}</div>
        ))}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissedKey(contentKey)}
        className="flex-shrink-0 font-semibold opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
