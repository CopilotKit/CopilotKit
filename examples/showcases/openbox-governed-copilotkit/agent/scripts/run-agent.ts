#!/usr/bin/env -S node --experimental-strip-types
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Script lives at agent/scripts/run-agent.ts, so dirname(dirname(...)) resolves
// to the agent/ directory — run the CLI there directly, no extra join needed.
const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

loadDotEnvWithoutOverridingProcess();

const result = spawnSync(
  "npx",
  ["@langchain/langgraph-cli@1.2.1", "dev", "--port", "8123", "--no-browser"],
  {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);

function loadDotEnvWithoutOverridingProcess() {
  const explicitEnv = new Set(Object.keys(process.env));
  for (const file of [".env.openbox", ".env"]) {
    const path = join(ROOT_DIR, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      if (!key || explicitEnv.has(key)) continue;
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
}
