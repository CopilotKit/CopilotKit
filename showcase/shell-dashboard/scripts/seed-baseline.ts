#!/usr/bin/env tsx
/**
 * seed-baseline.ts — Seeds PocketBase `baseline` collection from baseline-seed.json.
 *
 * Run: npx tsx scripts/seed-baseline.ts
 *
 * Env vars:
 *   POCKETBASE_URL    — PB instance URL (default: http://127.0.0.1:8090)
 *   PB_ADMIN_EMAIL    — admin/superuser email (required)
 *   PB_ADMIN_PASSWORD — admin/superuser password (required)
 */

import PocketBase from "pocketbase";
import seedData from "../src/data/baseline-seed.json";

const PB_URL = process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090";
const PB_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_PASSWORD = process.env.PB_ADMIN_PASSWORD;

const BATCH_SIZE = 50;

async function main() {
  if (!PB_EMAIL || !PB_PASSWORD) {
    console.error("Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD env vars");
    process.exit(1);
  }

  const pb = new PocketBase(PB_URL);

  // Authenticate: try PB 0.22+ _superusers first, fall back to PB 0.21 admins
  try {
    await pb.collection("_superusers").authWithPassword(PB_EMAIL, PB_PASSWORD);
  } catch {
    await (pb as any).admins.authWithPassword(PB_EMAIL, PB_PASSWORD);
  }

  console.log(`Authenticated. Seeding ${seedData.length} baseline records...`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < seedData.length; i += BATCH_SIZE) {
    const batch = seedData.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (entry) => {
      const key = `${entry.partnerSlug}:${entry.featureSlug}`;
      try {
        const existing = await pb
          .collection("baseline")
          .getFirstListItem(`key="${key}"`)
          .catch(() => null);

        if (existing) {
          skipped++;
          return;
        }

        await pb.collection("baseline").create({
          key,
          partner: entry.partnerSlug,
          feature: entry.featureSlug,
          status: entry.status,
          tags: entry.tags,
          updated_at: new Date().toISOString(),
          updated_by: "seed-script",
        });
        created++;
      } catch (err) {
        errors++;
        console.error(
          `  Failed: ${key}:`,
          err instanceof Error ? err.message : err,
        );
      }
    });

    await Promise.all(promises);
    console.log(
      `  Progress: ${Math.min(i + BATCH_SIZE, seedData.length)}/${seedData.length}`,
    );
  }

  console.log(
    `\nDone. Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`,
  );
}

main();
