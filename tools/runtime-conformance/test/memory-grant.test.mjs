import assert from "node:assert/strict";
import test from "node:test";
import { startPlatform } from "../platform.mjs";

test("memory fixture enforces existing scope and preserves records on denied writes", async (t) => {
  const platform = await startPlatform();
  t.after(() => platform.close());
  platform.memories.set("owned", {
    id: "owned",
    userId: "owner",
    scope: "user",
    content: "Original",
  });
  const headers = {
    Authorization: `Bearer ${platform.apiKey}`,
    "Content-Type": "application/json",
    "x-cpki-user-id": "owner",
    "x-cpki-memory-grant": JSON.stringify({
      user: "read",
      project: "read-write",
    }),
  };

  for (const method of ["PATCH", "DELETE"]) {
    const response = await fetch(`${platform.url}/api/memories/owned`, {
      method,
      headers,
      ...(method === "PATCH"
        ? { body: JSON.stringify({ content: "Denied", scope: "project" }) }
        : {}),
    });
    assert.equal(response.status, 403);
  }
  assert.equal(platform.memories.get("owned").invalidated, undefined);
  assert.equal(platform.memories.size, 1);
});
