/**
 * Pure formatter core for the SEO redirect-decommission report.
 *
 * Extracted from `redirect-decommission-report.ts` so the same body-rendering
 * logic the CLI prints to stdout can be driven from the showcase-harness probe
 * path without re-importing the PostHog HTTP client or spawning the CLI.
 * The CLI (`redirect-decommission-report.ts`) is now a thin wrapper around
 * `computeRedirectDecommission` — both code paths produce byte-identical
 * Slack / human-readable bodies, asserted via cross-check fixture in the
 * accompanying test.
 *
 * Inputs are fully provided by the caller (events list + redirect
 * definitions + lookback window) so this module has no filesystem or
 * network side effects. That's the contract that lets the showcase-harness
 * probe driver call it from a cron tick without dragging PostHog or the
 * shell import graph in.
 */

export interface EventCount {
  redirect_id: string;
  count: number;
}

export interface RedirectEntryLite {
  id: string;
  source: string;
  destination: string;
}

export interface RedirectDecommissionInput {
  /** PostHog query results — redirect_id + hit count. Order preserved for the top-10 list. */
  events: EventCount[];
  /** Full redirect catalogue (authoritative source of expected redirect IDs). */
  redirects: RedirectEntryLite[];
  /** Lookback window expressed in days, interpolated into the header line. */
  days: number;
  /** When true, emit Slack mrkdwn with emoji + grouping. When false, emit human-readable ASCII. */
  slackFormat: boolean;
}

export interface RedirectDecommissionResult {
  /** True when one or more redirects have zero hits (decommission candidates). */
  hasCandidates: boolean;
  /** Count of zero-hit candidates. */
  candidateCount: number;
  /** Fully rendered report body. Ready for triple-brace Slack interpolation or stdout. */
  body: string;
}

function assertValidInput(input: RedirectDecommissionInput): void {
  if (input === null || typeof input !== "object") {
    throw new TypeError(
      "redirect-decommission-core: input must be an object with events + redirects + days + slackFormat",
    );
  }
  if (!Array.isArray(input.events)) {
    throw new TypeError(
      "redirect-decommission-core: input.events must be an array of { redirect_id, count }",
    );
  }
  if (!Array.isArray(input.redirects)) {
    throw new TypeError(
      "redirect-decommission-core: input.redirects must be an array of redirect definitions",
    );
  }
  if (typeof input.days !== "number" || !Number.isFinite(input.days)) {
    throw new TypeError(
      "redirect-decommission-core: input.days must be a finite number",
    );
  }
  if (typeof input.slackFormat !== "boolean") {
    throw new TypeError(
      "redirect-decommission-core: input.slackFormat must be a boolean",
    );
  }
}

/**
 * Render the redirect-decommission report body from pre-fetched inputs.
 * Mirrors the legacy CLI `buildReport` byte-for-byte: the cross-check test
 * runs the CLI against the same input JSON and diffs the stdout.
 */
export function computeRedirectDecommission(
  input: RedirectDecommissionInput,
): RedirectDecommissionResult {
  assertValidInput(input);

  const { events, redirects, days, slackFormat } = input;

  const eventMap = new Map(events.map((e) => [e.redirect_id, e.count]));
  const totalHits = events.reduce((sum, e) => sum + e.count, 0);

  const allIds = new Set(redirects.map((r) => r.id));
  const zerohit = [...allIds].filter((id) => !eventMap.has(id)).sort();
  const top10 = events.slice(0, 10);

  if (slackFormat) {
    const lines: string[] = [];
    lines.push(
      `:bar_chart: *SEO Redirect Decommission Report* (last ${days} days)`,
    );
    lines.push(`Total redirects defined: ${allIds.size}`);
    lines.push(`Total hits: ${totalHits.toLocaleString()}`);
    lines.push("");

    if (zerohit.length > 0) {
      lines.push(
        `:warning: *${zerohit.length} redirect(s) with zero hits — decommission candidates:*`,
      );
      // Group by prefix for readability. Keep grouping identical to the legacy
      // CLI — the cross-check fixture asserts byte-identical output.
      const grouped = new Map<string, string[]>();
      for (const id of zerohit) {
        const prefix = id.replace(/×.*$/, "");
        if (!grouped.has(prefix)) grouped.set(prefix, []);
        grouped.get(prefix)!.push(id);
      }
      for (const [prefix, ids] of grouped) {
        if (ids.length <= 3) {
          lines.push(`  • ${ids.join(", ")}`);
        } else {
          lines.push(
            `  • ${prefix}: ${ids.length} entries (${ids.slice(0, 3).join(", ")}, ...)`,
          );
        }
      }
      lines.push("");
      lines.push(
        `Cross-reference: <https://www.notion.so/33c3aa38185281d7b243c5cf0a7c14cb|SEO Redirect Inventory>`,
      );
    } else {
      lines.push(
        `:white_check_mark: All redirects received traffic — no decommission candidates.`,
      );
    }

    if (top10.length > 0) {
      lines.push("");
      lines.push(`*Top 10 most-hit redirects:*`);
      for (const e of top10) {
        lines.push(`  ${e.redirect_id}: ${e.count.toLocaleString()} hits`);
      }
    }

    return {
      hasCandidates: zerohit.length > 0,
      candidateCount: zerohit.length,
      body: lines.join("\n"),
    };
  }

  // Human-readable format (matches legacy CLI verbatim).
  const lines: string[] = [];
  lines.push(`=== SEO Redirect Decommission Report (last ${days} days) ===`);
  lines.push(`Total redirects defined: ${allIds.size}`);
  lines.push(`Total hits: ${totalHits.toLocaleString()}`);
  lines.push(`Redirects with hits: ${eventMap.size}`);
  lines.push(`Zero-hit candidates: ${zerohit.length}`);
  lines.push("");

  if (top10.length > 0) {
    lines.push("Top 10 most-hit redirects:");
    for (const e of top10) {
      lines.push(
        `  ${e.redirect_id.padEnd(25)} ${e.count.toLocaleString()} hits`,
      );
    }
    lines.push("");
  }

  if (zerohit.length > 0) {
    lines.push("Decommission candidates (zero hits):");
    for (const id of zerohit) {
      const entry = redirects.find((r) => r.id === id);
      lines.push(
        `  ${id.padEnd(25)} ${entry?.source ?? "?"} → ${entry?.destination ?? "?"}`,
      );
    }
  }

  return {
    hasCandidates: zerohit.length > 0,
    candidateCount: zerohit.length,
    body: lines.join("\n"),
  };
}
