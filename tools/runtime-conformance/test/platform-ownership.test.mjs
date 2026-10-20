import assert from "node:assert/strict";
import test from "node:test";
import { startPlatform } from "../platform.mjs";

// Intelligence c5265330: threads-routes.ts hides inaccessible threads with
// THREAD_NOT_FOUND; errors/registry.ts maps that error to HTTP 404.
test("fixture thread lookup hides a foreign thread like a missing thread", async () => {
  const platform = await startPlatform();
  try {
    platform.threads.set("owned", {
      id: "owned",
      userId: "alice",
      agentId: "default",
      messages: [],
    });
    const lookup = (threadId) =>
      fetch(`${platform.url}/api/threads/${threadId}?userId=bob`, {
        headers: { Authorization: `Bearer ${platform.apiKey}` },
      });
    const foreign = await lookup("owned");
    const missing = await lookup("absent");
    assert.equal(foreign.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
  } finally {
    await platform.close();
  }
});
