#!/usr/bin/env node
/**
 * Seed a handful of realistic prior threads in CopilotKit Intelligence so the
 * threads-drawer isn't empty on first boot.
 *
 * Strategy: threads are created implicitly when an agent runs. We POST a
 * single message to /api/copilotkit/agent/default/run for each seed
 * thread, then rename the resulting thread via PATCH /threads/:id.
 *
 * Run with: node scripts/seed-threads.mjs
 *
 * Requires the BFF (port 4000) + Intelligence stack to be running. In
 * aimock mode (USE_MOCK=1), this completes deterministically.
 */

const BASE = process.env.RUNTIME_URL ?? "http://localhost:4000/api/copilotkit";

const SEED_THREADS = [
  {
    name: "Sprint planning — May 12",
    prompt: "Plan next sprint",
  },
  {
    name: "Bug triage — Safari",
    prompt: "Show me the open Safari bugs and triage them",
  },
  {
    name: "Q2 roadmap review",
    prompt:
      "Walk me through what's left on the Q2 roadmap and what we'll have to push to Q3",
  },
  {
    name: "Onboarding checklist",
    prompt:
      "Create a few onboarding checklist issues — read the docs, run the demo, deploy a test agent",
  },
];

async function runSeed(prompt) {
  const threadId = crypto.randomUUID();
  const res = await fetch(`${BASE}/agent/default/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.warn(`[seed] run failed (${res.status})`);
    return null;
  }
  // Drain the SSE stream so the run completes.
  if (res.body) {
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
  }
  return threadId;
}

async function rename(threadId, name) {
  const res = await fetch(`${BASE}/threads/${encodeURIComponent(threadId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: "default", name }),
  });
  if (!res.ok)
    console.warn(`[seed] rename failed for ${threadId}: ${res.status}`);
}

(async () => {
  for (const { name, prompt } of SEED_THREADS) {
    const threadId = await runSeed(prompt);
    if (!threadId) continue;
    await rename(threadId, name);
    console.log(`[seed] ${name} — ${threadId}`);
  }
  console.log("[seed] done");
})();
