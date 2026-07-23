/**
 * cli-pb.ts — shared glue for the `bin/showcase cvdiag` node entrypoints
 * (cli-classify / cli-replay / cli-purge), L2-B. Two concerns:
 *   - `loadCvdiagPbConfig()` — resolve the PocketBase superuser connection
 *     from the env, mirroring the orchestrator's contract
 *     (`POCKETBASE_URL` + `POCKETBASE_SUPERUSER_EMAIL/PASSWORD`). The CLI reads
 *     via the superuser (which bypasses the three-key ACL — the role keys are
 *     write-only, see the cvdiag_events migration), so a single superuser
 *     identity covers timeline/classify/replay reads AND the purge DELETE.
 *   - `sortByTimeline()` — order events for a single test. `mono_ns` is
 *     authoritative WITHIN a layer; ACROSS layers wall-clock `ts` is the only
 *     shared clock (reliable to ±50ms, per schema §5). We therefore sort by
 *     `ts` first, breaking ties by `mono_ns` so same-millisecond events from
 *     one layer keep their emit order.
 *
 * Kept thin and dependency-light so the entrypoints stay pure glue over the
 * classifier (L2-A) and pb-writer (L0-B).
 */

import type { CvdiagEnvelope } from "./schema.js";

export interface CvdiagPbConfig {
  url: string;
  email: string | undefined;
  password: string | undefined;
}

/**
 * Resolve the PB connection for the CLI. `POCKETBASE_URL` is required in any
 * real run (the CLI talks to a live PB); we default to localhost only under
 * the same test/escape-hatch contract the orchestrator uses so local dev does
 * not need the var set. Credentials are optional here — an unauthenticated
 * read against a superuser-only collection simply 401s, which the pb-client
 * surfaces as a clear error.
 */
export function loadCvdiagPbConfig(): CvdiagPbConfig {
  const rawUrl = process.env.POCKETBASE_URL;
  let url: string;
  if (typeof rawUrl === "string" && rawUrl.length > 0) {
    url = rawUrl;
  } else if (
    process.env.NODE_ENV === "test" ||
    process.env.HARNESS_ALLOW_NO_PB_URL === "1"
  ) {
    url = "http://localhost:8090";
  } else {
    throw new Error(
      "POCKETBASE_URL is required for bin/showcase cvdiag — set it in the env " +
        "(or NODE_ENV=test / HARNESS_ALLOW_NO_PB_URL=1 for local dev).",
    );
  }
  return {
    url,
    email: process.env.POCKETBASE_SUPERUSER_EMAIL,
    password: process.env.POCKETBASE_SUPERUSER_PASSWORD,
  };
}

/**
 * Return a NEW array of the events ordered for a single-test timeline. Stable
 * across the cross-layer ±50ms skew: primary key wall-clock `ts`, tie-break on
 * `mono_ns` (authoritative within a layer). Does not mutate the input.
 */
export function sortByTimeline(events: CvdiagEnvelope[]): CvdiagEnvelope[] {
  return [...events].sort((a, b) => {
    if (a.ts < b.ts) return -1;
    if (a.ts > b.ts) return 1;
    return a.mono_ns - b.mono_ns;
  });
}
