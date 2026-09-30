#!/usr/bin/env node
// `npm run doctor`: is everything this app needs actually in place?
// Checks the same things the runtime relies on, in the same order it would fail.

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import nextEnv from "@next/env";

const rows = [];
const row = (name, ok, detail) => rows.push({ name, ok, detail });

// Match the app's environment-file precedence.
nextEnv.loadEnvConfig(process.cwd());

const ant = spawnSync("ant", ["--version"], { encoding: "utf8" });
row(
  "ant CLI",
  ant.status === 0 || Boolean(process.env.ANTHROPIC_API_KEY),
  ant.status === 0
    ? ant.stdout.trim()
    : "not installed (fine if ANTHROPIC_API_KEY is set)",
);

let lock = null;
try {
  lock = JSON.parse(fs.readFileSync("claude-lock.json", "utf8"));
} catch {}
const rs = Object.values(lock?.resources ?? {});
const agentId =
  process.env.ANTHROPIC_AGENT_ID || rs.find((r) => r.kind === "agent")?.id;
const environmentId =
  process.env.ANTHROPIC_ENVIRONMENT_ID ||
  rs.find((r) => r.kind === "environment")?.id;
row(
  "agent id",
  Boolean(agentId),
  agentId ?? "missing: run `npm run agent:apply`",
);
row(
  "environment id",
  Boolean(environmentId),
  environmentId ?? "missing: run `npm run agent:apply`",
);

const authMode = process.env.ANTHROPIC_API_KEY
  ? "ANTHROPIC_API_KEY"
  : `ant profile (${process.env.ANTHROPIC_PROFILE || "active"})`;
try {
  const client = new Anthropic({ timeout: 5_000, maxRetries: 0 });
  if (agentId) {
    const agent = await client.beta.agents.retrieve(agentId);
    row("credentials", true, `${authMode}`);
    row(
      "agent reachable",
      true,
      `${agent.name} · ${typeof agent.model === "string" ? agent.model : agent.model?.id} · v${agent.version}`,
    );
  } else {
    await client.beta.agents.list({ limit: 1 });
    row("credentials", true, authMode);
  }
  if (environmentId) {
    const env = await client.beta.environments.retrieve(environmentId);
    row("environment reachable", true, env.name);
  }
} catch (e) {
  row(
    "credentials / API",
    false,
    `${authMode}: ${e?.status ?? ""} Check workspace access and credits, then retry.`,
  );
}

const containerId = process.env.CPK_INTELLIGENCE_LEARNING_CONTAINER_ID;
const intelligenceKey = process.env.CPK_INTELLIGENCE_API_KEY;
row(
  "local app user",
  Boolean(process.env.CPK_APP_USER_ID),
  process.env.CPK_APP_USER_ID
    ? "configured"
    : "set CPK_APP_USER_ID in .env.local",
);
try {
  if (!containerId || !intelligenceKey)
    throw new Error("missing configuration");
  const intelligence = new CopilotKitIntelligence({
    apiKey: intelligenceKey,
    ...(process.env.INTELLIGENCE_API_URL
      ? { apiUrl: process.env.INTELLIGENCE_API_URL }
      : {}),
    ...(process.env.INTELLIGENCE_GATEWAY_WS_URL
      ? { wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL }
      : {}),
  });
  await intelligence.getLearnedSkillsSnapshot({
    containerId,
    signal: AbortSignal.timeout(5_000),
  });
  row("Learning Skills", true, `container ${containerId} is readable`);
} catch {
  row(
    "Learning Skills",
    false,
    "check the project key, container ID, and Learning access in .env.local",
  );
}

row(
  "mock mode",
  true,
  process.env.AGENT_URL
    ? `AGENT_URL=${process.env.AGENT_URL} (Managed Agents bypassed)`
    : "off",
);

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows)
  console.log(
    `${r.ok ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m"} ${r.name.padEnd(width)}  ${r.detail}`,
  );
process.exit(rows.every((r) => r.ok) ? 0 : 1);
