/**
 * SEO Redirect Decommission Report
 *
 * Queries PostHog for seo_redirect events over the last 30 days,
 * cross-references against the redirect array, and outputs:
 *   - Total redirect traffic
 *   - Top 10 most-hit redirects
 *   - Zero-hit decommission candidates
 *
 * Usage:
 *   POSTHOG_API_KEY=phx_... npx tsx showcase/scripts/redirect-decommission-report.ts
 *   POSTHOG_API_KEY=phx_... npx tsx showcase/scripts/redirect-decommission-report.ts --slack
 *
 * The --slack flag outputs a Slack-formatted message to stdout (for CI).
 * Without --slack, outputs a human-readable report.
 */

import { seoRedirects } from "../shell/src/lib/seo-redirects";

const POSTHOG_HOST = "https://eu.i.posthog.com";
const DAYS = 30;

interface EventCount {
  redirect_id: string;
  count: number;
}

function parseArgs(): { slackFormat: boolean } {
  return { slackFormat: process.argv.includes("--slack") };
}

async function queryPostHog(
  apiKey: string,
  projectId: string,
): Promise<EventCount[]> {
  const now = new Date();
  const from = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);

  const query = {
    kind: "HogQLQuery",
    query: `
            SELECT
                properties.redirect_id AS redirect_id,
                count() AS cnt
            FROM events
            WHERE event = 'seo_redirect'
              AND timestamp >= toDateTime('${from.toISOString()}')
              AND timestamp <= toDateTime('${now.toISOString()}')
            GROUP BY redirect_id
            ORDER BY cnt DESC
        `,
  };

  const res = await fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const results: EventCount[] = [];
  for (const row of data.results || []) {
    results.push({ redirect_id: row[0], count: row[1] });
  }
  return results;
}

function buildReport(
  events: EventCount[],
  slackFormat: boolean,
): { text: string; hasCandidates: boolean } {
  const eventMap = new Map(events.map((e) => [e.redirect_id, e.count]));
  const totalHits = events.reduce((sum, e) => sum + e.count, 0);

  // All unique redirect IDs from the definitions
  const allIds = new Set(seoRedirects.map((r) => r.id));
  const zerohit = [...allIds].filter((id) => !eventMap.has(id)).sort();

  const top10 = events.slice(0, 10);

  if (slackFormat) {
    const lines: string[] = [];
    lines.push(
      `:bar_chart: *SEO Redirect Decommission Report* (last ${DAYS} days)`,
    );
    lines.push(`Total redirects defined: ${allIds.size}`);
    lines.push(`Total hits: ${totalHits.toLocaleString()}`);
    lines.push("");

    if (zerohit.length > 0) {
      lines.push(
        `:warning: *${zerohit.length} redirect(s) with zero hits — decommission candidates:*`,
      );
      // Group by prefix for readability
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

    return { text: lines.join("\n"), hasCandidates: zerohit.length > 0 };
  }

  // Human-readable format
  const lines: string[] = [];
  lines.push(`=== SEO Redirect Decommission Report (last ${DAYS} days) ===`);
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
      const entry = seoRedirects.find((r) => r.id === id);
      lines.push(
        `  ${id.padEnd(25)} ${entry?.source ?? "?"} → ${entry?.destination ?? "?"}`,
      );
    }
  }

  return { text: lines.join("\n"), hasCandidates: zerohit.length > 0 };
}

async function main() {
  const { slackFormat } = parseArgs();

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.error("POSTHOG_API_KEY env var is required");
    process.exit(1);
  }

  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!projectId) {
    console.error("POSTHOG_PROJECT_ID env var is required");
    process.exit(1);
  }

  const events = await queryPostHog(apiKey, projectId);
  const { text, hasCandidates } = buildReport(events, slackFormat);

  console.log(text);

  // Exit code signals CI whether to post to Slack
  if (slackFormat && !hasCandidates) {
    process.exit(2); // No candidates — CI should skip Slack post
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
