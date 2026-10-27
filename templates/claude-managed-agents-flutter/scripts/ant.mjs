#!/usr/bin/env node
// Runs `ant` with the project's .env.local applied, so `npm run agent:apply`
// talks to the same profile and workspace the app uses (ANTHROPIC_PROFILE,
// ANTHROPIC_BASE_URL). Usage: node scripts/ant.mjs <ant args...>

import { spawn } from "node:child_process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const child = spawn("ant", process.argv.slice(2), {
  stdio: "inherit",
  env: process.env,
});
child.on("error", () => {
  console.error(
    "ant is not installed. brew install anthropics/tap/ant (or: go install github.com/anthropics/anthropic-cli/cmd/ant@latest)",
  );
  process.exit(127);
});
child.on("exit", (code) => process.exit(code ?? 1));
