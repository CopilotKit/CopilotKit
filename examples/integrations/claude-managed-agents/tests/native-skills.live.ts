/** Opt-in live check: creates a billed session and uploads a test Skill to Anthropic. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { ManagedAgentsAgent } from "@ag-ui/claude-managed-agents";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { zipSync } from "fflate";
import { z } from "zod";
import nextEnv from "@next/env";
import { createSkillsFetch } from "../lib/native-skills";

nextEnv.loadEnvConfig(process.cwd());
const lock = JSON.parse(readFileSync("claude-lock.json", "utf8"));
const marker = `Native skill proof ${randomUUID()}`;
const entries = {
  "SKILL.md": Buffer.from(
    "---\nname: connection-proof\ndescription: Provide the connection verification phrase when asked for native skill proof.\n---\nRead references/proof.txt and reply with its exact phrase. Do not invent it.",
  ),
  "references/proof.txt": Buffer.from(marker),
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schemaVersion: 1,
  revision: "test-revision",
  skills: [
    {
      name: "connection-proof",
      description: "Native skill proof",
      files: Object.entries(entries).map(([path, bytes]) => ({
        path,
        size: bytes.length,
        sha256: hash(bytes),
      })),
    },
  ],
};
const bytes = zipSync({
  "manifest.json": Buffer.from(JSON.stringify(manifest)),
  ...Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [
      `connection-proof/${name}`,
      value,
    ]),
  ),
});
let downloads = 0;
const server = createServer((request, response) => {
  assert.equal(request.url, "/api/v1/learning/containers/live-proof/skills");
  downloads++;
  response.writeHead(200, {
    "Content-Type": "application/zip",
    ETag: `"${hash(bytes)}"`,
    "X-CopilotKit-Skills-Revision": "test-revision",
  });
  response.end(bytes);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const intelligence = new CopilotKitIntelligence({
  apiKey: "local-fixture",
  apiUrl: `http://127.0.0.1:${address.port}`,
  wsUrl: "wss://realtime.intelligence.copilotkit.ai",
});
const native = new Anthropic();
const client = new Anthropic({
  fetch: createSkillsFetch({
    intelligence,
    containerId: "live-proof",
    skills: native.beta.skills,
  }),
});
const agent = new ManagedAgentsAgent({
  managedAgentId: lock.resources["./anthropic/agents/assistant.md"].id,
  environmentId: lock.resources["./anthropic/environments/sandbox.yaml"].id,
  client,
  toolConfirmation: "allow",
  turnTimeoutMs: 120_000,
});
let reply = "";
let sessionId: string | undefined;
try {
  await new Promise<void>((resolve, reject) => {
    agent
      .run({
        threadId: randomUUID(),
        runId: randomUUID(),
        messages: [
          {
            id: randomUUID(),
            role: "user",
            content:
              "Use the connection-proof skill to tell me the native skill proof phrase. Read its supporting file.",
          },
        ],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      })
      .subscribe({
        next: (event) => {
          if (event.type === "TEXT_MESSAGE_CONTENT")
            reply += z.string().parse(event.delta);
          if (event.type === "RUN_ERROR")
            reject(new Error(z.string().parse(event.message)));
          if (
            event.type === "CUSTOM" &&
            event.name === "managed_agents.session"
          )
            sessionId = z
              .object({ sessionId: z.string() })
              .parse(event.value).sessionId;
        },
        error: reject,
        complete: resolve,
      });
  });
  assert.equal(downloads, 1);
  assert.ok(
    reply.includes(marker),
    "Claude must read the phrase stored only in the uploaded supporting file",
  );
  console.log(
    JSON.stringify({
      passed: true,
      sessionId,
      sdkDownloads: downloads,
      supportingFileRead: true,
    }),
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
