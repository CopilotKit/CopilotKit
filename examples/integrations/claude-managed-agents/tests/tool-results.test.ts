import assert from "node:assert/strict";
import { test } from "node:test";
import { fillEmptyToolResults } from "../lib/tool-results";

test("render-only tools get a nonempty result while approval results stay unchanged", async () => {
  const input = {
    messages: [
      { role: "tool", content: "" },
      { role: "tool", content: '{"approved":false}' },
      { role: "user", content: "" },
    ],
  };
  const request = new Request("http://localhost/api/copilotkit", {
    method: "POST",
    body: JSON.stringify(input),
  });

  const response = await fillEmptyToolResults(request);

  assert.deepEqual(await response.json(), {
    messages: [
      { role: "tool", content: "Rendered in the UI." },
      input.messages[1],
      input.messages[2],
    ],
  });
});

test("rewriting the body preserves caller cancellation", async () => {
  const controller = new AbortController();
  const request = new Request("http://localhost/api/copilotkit", {
    method: "POST",
    body: '{"messages":[]}',
    signal: controller.signal,
  });

  const forwarded = await fillEmptyToolResults(request);
  controller.abort();

  assert.equal(forwarded.signal.aborted, true);
});
