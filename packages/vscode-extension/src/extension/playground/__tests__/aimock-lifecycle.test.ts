import { describe, expect, it } from "vitest";
import { startAimock } from "../aimock-lifecycle";

describe("startAimock", () => {
  it("starts an LLMock on a random localhost port and exposes its URL", async () => {
    const handle = await startAimock({
      provider: "openai",
      upstreamUrl: "https://api.openai.com",
    });
    try {
      expect(handle.url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
      expect(handle.provider).toBe("openai");
    } finally {
      await handle.stop();
    }
  }, 10_000);

  it("records requests to the journal", async () => {
    const handle = await startAimock({
      provider: "openai",
      upstreamUrl: "https://api.openai.com",
    });
    try {
      // Send a request to aimock; don't worry about it matching a fixture or
      // actually reaching upstream — we only care that the journal captures it.
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
  }, 15_000);
});
