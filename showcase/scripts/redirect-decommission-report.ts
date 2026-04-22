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
 *
 * For deterministic replay (cross-check fixture generation / offline
 * smoke-test), pass `--events-json=<path>` to skip the PostHog fetch and
 * read an EventCount[] array from disk instead. The PostHog env-var checks
 * are also skipped in this mode. Intended for tests and reproducible
 * diffs — do not use in scheduled runs.
 *
 * Formatter logic lives in `./redirect-decommission-core.ts` so showcase-ops
 * can drive the same body from a probe tick. Any drift between this CLI
 * and that core is caught by a byte-for-byte cross-check in
 * `showcase/ops/test/fixtures/redirect-decommission/cli-stdout.txt`.
 */

import fs from "fs";
// Named-import interop: `../shell/src/lib/seo-redirects` has no "type":"module"
// one level up, so tsx under Node 25 surfaces its exports via the CJS `default`
// namespace rather than direct named bindings. Use a namespace import and
// pick either shape to stay compatible across both toolchains.
import * as seoRedirectsModule from "../shell/src/lib/seo-redirects";
import {
  computeRedirectDecommission,
  type EventCount,
  type RedirectEntryLite,
} from "./redirect-decommission-core";

const seoRedirects: RedirectEntryLite[] = (
  (seoRedirectsModule as { seoRedirects?: RedirectEntryLite[] }).seoRedirects ??
  (seoRedirectsModule as unknown as { default?: { seoRedirects?: RedirectEntryLite[] } })
    .default?.seoRedirects ??
  []
) as RedirectEntryLite[];

const POSTHOG_HOST = "https://eu.i.posthog.com";
const DAYS = 30;

interface ParsedArgs {
  slackFormat: boolean;
  eventsJsonPath: string | null;
}

function parseArgs(): ParsedArgs {
  const slackFormat = process.argv.includes("--slack");
  let eventsJsonPath: string | null = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--events-json=")) {
      eventsJsonPath = arg.slice("--events-json=".length);
    }
  }
  return { slackFormat, eventsJsonPath };
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

function loadEventsFromFile(path: string): EventCount[] {
  const raw = fs.readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(
      `--events-json fixture at ${path} is not a JSON array of { redirect_id, count }`,
    );
  }
  return parsed as EventCount[];
}

async function main() {
  const { slackFormat, eventsJsonPath } = parseArgs();

  let events: EventCount[];
  if (eventsJsonPath) {
    // Offline / fixture-driven mode — used by the cross-check test and for
    // reproducible golden generation. Skips PostHog entirely.
    events = loadEventsFromFile(eventsJsonPath);
  } else {
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

    events = await queryPostHog(apiKey, projectId);
  }

  const { body, hasCandidates } = computeRedirectDecommission({
    events,
    redirects: seoRedirects,
    days: DAYS,
    slackFormat,
  });

  console.log(body);

  // Exit code signals CI whether to post to Slack
  if (slackFormat && !hasCandidates) {
    process.exit(2); // No candidates — CI should skip Slack post
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
