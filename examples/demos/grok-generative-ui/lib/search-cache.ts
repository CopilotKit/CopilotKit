import { promises as fs } from "fs";
import path from "path";
import type { DiscourseReport } from "./discourse";

/**
 * Disk cache for x_search results.
 *
 * A cold search costs 45-75s, which makes iterating on the UI (and recording)
 * painful. Entries are written from REAL searches — nothing here is authored by
 * hand — so a cache hit renders exactly what a live run would, minus the wait.
 * The recording already cuts that wait; this makes the app itself feel that way.
 *
 * Deliberately NOT a stale-time cache. Entries live until deleted, because the
 * point is a stable, replayable demo, not freshness. Pass `fresh: true` to
 * bypass and overwrite.
 */

const DIR = path.join(process.cwd(), ".cache", "x-search");

/** Cache entries carry when they were captured so staleness is inspectable. */
export interface CachedReport extends DiscourseReport {
  cachedAt: string;
}

function keyFor(topic: string): string {
  const slug = topic
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

async function readEntry(key: string): Promise<CachedReport | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(DIR, `${key}.json`), "utf8"),
    ) as CachedReport;
  } catch {
    // Missing file, unreadable dir, or corrupt JSON all mean the same thing to
    // the caller: no usable entry.
    return null;
  }
}

/** Below this, a substring match is too loose to trust ("ui" would hit anything). */
const MIN_FUZZY_LEN = 5;

export async function readCache(topic: string): Promise<CachedReport | null> {
  const key = keyFor(topic);

  const direct = await readEntry(key);
  if (direct) return direct;

  /**
   * The agent does not pass the user's sentence through — it extracts a topic.
   * "what is X saying about grok 4.6?" arrives here as "grok 4.6", and the
   * phrasing drifts between runs ("AG-UI" / "the AG-UI protocol"). Exact keys
   * alone miss constantly, so fall back to containment in either direction.
   *
   * keyFor already folds case and punctuation, so "Grok 4.6", "grok-4.6" and
   * "grok 4.6" collapse to one key before we get here.
   */
  if (key.length < MIN_FUZZY_LEN) return null;

  const files = await fs.readdir(DIR).catch(() => [] as string[]);
  const match = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .filter((k) => k.length >= MIN_FUZZY_LEN)
    // Longest match wins, so "grok-4-6" beats a broader entry that also fits.
    .sort((a, b) => b.length - a.length)
    .find((k) => k.includes(key) || key.includes(k));

  return match ? readEntry(match) : null;
}

export async function writeCache(
  topic: string,
  report: DiscourseReport,
): Promise<void> {
  try {
    await fs.mkdir(DIR, { recursive: true });
    const entry: CachedReport = {
      ...report,
      cachedAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(DIR, `${keyFor(topic)}.json`),
      JSON.stringify(entry, null, 2),
      "utf8",
    );
  } catch (err) {
    // A cache write failing must never fail the request — the caller already
    // has the report it needs.
    console.warn("[x-search] cache write failed:", err);
  }
}
