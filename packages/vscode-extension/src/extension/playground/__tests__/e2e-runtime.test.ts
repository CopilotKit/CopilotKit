import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startAimock } from "../aimock-lifecycle";
import { spawnRuntime } from "../runtime-spawn";

const ENTRY_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "dist",
  "runtime",
  "subprocess-entry.cjs",
);

const API_KEY = process.env.OPENAI_API_KEY_TEST ?? process.env.OPENAI_API_KEY;

const describeIfKey = API_KEY ? describe : describe.skip;

describeIfKey("e2e: aimock + runtime against OpenAI", () => {
  let handles: Array<{ stop(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.allSettled(handles.map((h) => h.stop()));
    handles = [];
  });

  it("runtime responds and aimock records the upstream LLM call", async () => {
    const aimock = await startAimock({
      provider: "openai",
      upstreamUrl: "https://api.openai.com",
    });
    handles.push(aimock);

    const runtime = await spawnRuntime({
      entryScript: ENTRY_PATH,
      config: {
        port: 0,
        llmBaseUrl: aimock.url,
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: API_KEY!,
      },
      timeoutMs: 15_000,
    });
    handles.push(runtime);

    // Fire a minimal request at the runtime's CopilotKit endpoint. Exact
    // shape depends on the runtime's SSE handler — we only assert that
    // the HTTP response came back AND that aimock captured ≥1 journal
    // entry (proving the runtime actually called the LLM layer).
    const res = await fetch(`${runtime.url}/api/copilotkit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: "test-thread",
        messages: [{ role: "user", content: "say hi in one word" }],
      }),
    });

    // The endpoint returns SSE; just drain the body so the connection closes.
    await res.text();

    // Whether the response was 200 or 4xx depends on the exact AG-UI
    // request shape — we don't own that contract here. The stronger
    // signal is whether aimock saw upstream traffic.
    const journal = aimock.getJournal();
    expect(journal.length).toBeGreaterThan(0);
  }, 30_000);
});
