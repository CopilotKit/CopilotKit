import { describe, expect, it } from "vitest";
import { startAimock } from "../aimock-lifecycle";

describe("startAimock", () => {
  it("starts an LLMock on a random localhost port and exposes its URL", async () => {
    const handle = await startAimock({
      provider: "openai",
      enableUpstreamRecording: false,
    });
    try {
      expect(handle.url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
      expect(handle.provider).toBe("openai");
    } finally {
      await handle.stop();
    }
  }, 5_000);

  it("records requests to the journal (no upstream)", async () => {
    const handle = await startAimock({
      provider: "openai",
      enableUpstreamRecording: false,
    });
    try {
      // Send a request to aimock. Without a fixture match it returns 503,
      // but crucially the journal still captures the inbound request — we
      // don't follow the upstream-proxy path because the test doesn't need
      // to assert on the response body, only on journal capture.
      await fetch(`${handle.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
        }),
      }).catch(() => undefined);
      const journal = handle.getJournal();
      expect(journal.length).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.stop();
    }
  }, 5_000);
});
