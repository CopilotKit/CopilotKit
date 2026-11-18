/**
 * Primes the disk cache for the three starter prompts.
 *
 *   npx tsx scripts/warm-cache.ts          # skip topics already cached
 *   npx tsx scripts/warm-cache.ts --fresh  # re-search everything
 *
 * Run this before recording or demoing. Each cold topic costs 45-75s; after
 * this, every starter prompt renders as fast as the model can call its render
 * tools. Searches run sequentially — xAI rate-limits concurrent x_search calls.
 */

import { config } from "dotenv";
import { searchXDiscourse } from "../lib/x-search";
import { readCache, writeCache } from "../lib/search-cache";

config({ path: ".env.local" });

/**
 * The TOPIC the agent extracts, not the prompt the user types.
 *
 * `searchX` receives "grok 4.6" for "what is X saying about grok 4.6?" — warming
 * the full sentence writes a key nothing ever looks up. These mirror the three
 * SUGGESTIONS in app/page.tsx, reduced the way the model reduces them; the
 * cache's fuzzy lookup absorbs the remaining drift in phrasing.
 */
const TOPICS = ["grok 4.6", "AG-UI", "generative UI"];

async function main() {
  const fresh = process.argv.includes("--fresh");

  if (!process.env.XAI_API_KEY) {
    console.error("XAI_API_KEY missing — add it to .env.local");
    process.exit(1);
  }

  for (const topic of TOPICS) {
    if (!fresh && (await readCache(topic))) {
      console.log(`· cached    ${topic}`);
      continue;
    }

    const started = Date.now();
    process.stdout.write(`· searching ${topic}`);
    try {
      const report = await searchXDiscourse(topic);
      await writeCache(topic, report);
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(
        `\r✓ ${secs}s ${" ".repeat(6 - String(secs).length)}${topic} — ${report.posts.length} posts`,
      );
    } catch (err) {
      console.log(`\r✗ failed   ${topic}`);
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

void main();
