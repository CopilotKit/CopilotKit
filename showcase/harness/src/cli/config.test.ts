import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { loadConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// showcase/harness/src/cli -> showcase
const SHOWCASE_DIR = path.resolve(__dirname, "../../..");
const COMPOSE_FILE = path.join(SHOWCASE_DIR, "docker-compose.local.yml");

/**
 * Read the superuser email the PocketBase service is seeded with in
 * docker-compose.local.yml. The PB `entrypoint.sh` creates exactly this
 * superuser, so it is the single source of truth for the credential the
 * host CLI must authenticate as. A fresh isolated PB volume ONLY has this
 * account — if the host default disagrees the pb-auth login 400s and the
 * d6 control plane enqueues 0 jobs.
 */
function composeSeededSuperuserEmail(): string {
  const doc = yaml.load(fs.readFileSync(COMPOSE_FILE, "utf-8")) as {
    services: Record<string, { environment?: string[] }>;
  };
  const env = doc.services.pocketbase.environment ?? [];
  const entry = env.find((e) => e.startsWith("POCKETBASE_SUPERUSER_EMAIL="));
  if (!entry) {
    throw new Error(
      "POCKETBASE_SUPERUSER_EMAIL not set on the pocketbase service in docker-compose.local.yml",
    );
  }
  return entry.slice("POCKETBASE_SUPERUSER_EMAIL=".length);
}

describe("loadConfig() — PocketBase superuser default", () => {
  const SUPERUSER_ENV_KEYS = [
    "POCKETBASE_SUPERUSER_EMAIL",
    "POCKETBASE_SUPERUSER_PASSWORD",
    "POCKETBASE_URL_LOCAL",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Clear superuser env so we exercise the hardcoded config default — the
    // host shell does NOT load showcase/.env (compose passes it to containers
    // only), so an isolated `bin/showcase` run falls through to this default.
    for (const key of SUPERUSER_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of SUPERUSER_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults the superuser email to the value docker-compose.local.yml seeds", () => {
    // Single source of truth: docker-compose.local.yml:130
    // POCKETBASE_SUPERUSER_EMAIL. The host CLI default MUST match the
    // compose-seeded superuser or isolated PB volumes 400 on pb-auth.
    const expected = composeSeededSuperuserEmail();
    expect(loadConfig().pocketbase.email).toBe(expected);
  });
});
