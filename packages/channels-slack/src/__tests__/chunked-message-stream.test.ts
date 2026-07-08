import { describe, it, expect } from "vitest";
import { ChunkedMessageStream } from "../chunked-message-stream.js";

function makeFakeSlack(updateDurationMs = 0) {
  const posts: { ts: string; text: string }[] = [];
  const updates: { ts: string; text: string }[] = [];
  let counter = 0;
  return {
    posts,
    updates,
    postPlaceholder: async (text: string) => {
      counter++;
      const ts = `${counter}.0`;
      posts.push({ ts, text });
      return ts;
    },
    updateAt: async (ts: string, text: string) => {
      if (updateDurationMs > 0)
        await new Promise((r) => setTimeout(r, updateDurationMs));
      updates.push({ ts, text });
    },
  };
}

const longString = (n: number) =>
  "lorem ipsum ".repeat(Math.ceil(n / 12)).slice(0, n);

describe("ChunkedMessageStream", () => {
  it("stays as a single message when buffer fits in one chunk", async () => {
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 100,
      minIntervalMs: 0,
    });
    s.append("short reply");
    await s.finish();
    expect(slack.posts).toHaveLength(1);
    expect(slack.posts[0]!.text).toBe("_thinking…_");
    expect(slack.updates.at(-1)?.text).toBe("short reply");
  });

  it("splits into multiple messages when buffer exceeds the limit", async () => {
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 50,
      minIntervalMs: 0,
    });
    s.append(longString(200));
    await s.finish();
    expect(slack.posts.length).toBeGreaterThanOrEqual(4);
    // First placeholder = thinking, rest = continued
    expect(slack.posts[0]!.text).toBe("_thinking…_");
    expect(slack.posts[1]!.text).toBe("_…(continued)_");
  });

  it("frozen boundaries don't move — already-posted chunks never shrink", async () => {
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 50,
      minIntervalMs: 0,
    });
    s.append(longString(60));
    await s.finish();
    const chunkAfter1 =
      slack.updates.filter((u) => u.ts === "1.0").at(-1)?.text ?? "";
    // Now feed a fresh stream the same prefix and see that chunk 1 keeps
    // the same content even when extra growth happens.
    const slack2 = makeFakeSlack();
    const s2 = new ChunkedMessageStream({
      ...slack2,
      limit: 50,
      minIntervalMs: 0,
    });
    s2.append(longString(60));
    // Let the first dispatch settle by yielding briefly.
    await new Promise((r) => setTimeout(r, 5));
    s2.append(longString(120));
    await s2.finish();
    const chunkAfter1_b =
      slack2.updates.filter((u) => u.ts === "1.0").at(-1)?.text ?? "";
    expect(chunkAfter1).toBe(chunkAfter1_b);
  });

  it("prefers to break at newlines, then spaces", async () => {
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 30,
      minIntervalMs: 0,
    });
    s.append("first paragraph here.\nsecond paragraph here.\nthird here.");
    await s.finish();
    const chunk1 =
      slack.updates.filter((u) => u.ts === "1.0").at(-1)?.text ?? "";
    // Should not contain a partial word — last char should be a space or newline boundary.
    expect(
      chunk1.endsWith("\n") || chunk1.endsWith(" ") || /\.[\s]?$/.test(chunk1),
    ).toBe(true);
  });

  it("concatenated chunks equal the full buffer (no characters lost)", async () => {
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 40,
      minIntervalMs: 0,
    });
    const full = longString(300);
    s.append(full);
    await s.finish();
    // Take the last update per ts in posted order
    const final: Record<string, string> = {};
    for (const u of slack.updates) final[u.ts] = u.text;
    const concatenated = Object.entries(final)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v)
      .join("");
    expect(concatenated).toBe(full);
  });

  it("applies the transform per chunk before chat.update", async () => {
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 100,
      minIntervalMs: 0,
      transform: (t) => t.toUpperCase(),
    });
    s.append("hello world");
    await s.finish();
    expect(slack.updates.at(-1)?.text).toBe("HELLO WORLD");
  });

  it("block-keeps-whole: a fenced block that fits in a new chunk goes whole into the next message", async () => {
    // 200 chars of prose + a 60-char fenced block. With limit=120, the
    // ideal boundary would land inside the fence. The block-keeps-whole
    // logic should pull the boundary back to BEFORE the fence so chunk 2
    // contains the entire fence cleanly.
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 120,
      minIntervalMs: 0,
    });
    // Prose just under the limit, so we end up with exactly two chunks.
    const prose = "lorem ipsum dolor sit amet ".repeat(4); // 108 chars
    const block = "```python\nprint('hi')\nprint('bye')\n```";
    const fullText = prose + block;
    s.append(fullText);
    await s.finish();

    expect(slack.posts.length).toBeGreaterThanOrEqual(2);
    // Find the FINAL state of each chunk message
    const finals: Record<string, string> = {};
    for (const u of slack.updates) finals[u.ts] = u.text;
    const chunk1 = finals["1.0"] ?? "";
    const chunk2 = finals["2.0"] ?? "";
    // Chunk 1 must not contain the fence at all — the block moved to chunk 2.
    expect(chunk1.includes("```")).toBe(false);
    // Chunk 2 must contain the whole block.
    expect(chunk2.includes("```python")).toBe(true);
    expect(chunk2.trim().endsWith("```")).toBe(true);
    expect(chunk2.includes("print('hi')")).toBe(true);
    expect(chunk2.includes("print('bye')")).toBe(true);
  });

  it("fallback: a block too big to fit in one chunk uses the re-opener path", async () => {
    // Make a block bigger than the limit so the boundary can't move
    // back without leaving chunk N empty. Re-opener prefix is used instead.
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 80,
      minIntervalMs: 0,
    });
    const code = "x = 1\n".repeat(40); // ~240 chars of code
    const fullText = "preamble. ```python\n" + code + "```";
    s.append(fullText);
    await s.finish();

    expect(slack.posts.length).toBeGreaterThanOrEqual(2);
    const finals: Record<string, string> = {};
    for (const u of slack.updates) finals[u.ts] = u.text;
    const chunk2 = finals["2.0"] ?? "";
    // Chunk 2 must begin with a fence opener (re-opener path).
    expect(chunk2.startsWith("```python\n")).toBe(true);
  });

  it("continuation chunk re-opens a fence when the boundary is inside ```python", async () => {
    // Reproduces the user-reported python decorators bug: a long fenced
    // code block split across two Slack messages → chunk 2 must start
    // with the fence opener (and the chunk 1 will close with ``` thanks
    // to autoCloseOpenMarkdown applied via the transform).
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 80,
      minIntervalMs: 0,
    });
    // Synthesise enough code in one fence to overflow the limit.
    const longCode = Array.from({ length: 12 }, (_, i) => `print(${i})`).join(
      "\n",
    );
    const fullText = "```python\n" + longCode + "\n```";
    s.append(fullText);
    await s.finish();
    expect(slack.posts.length).toBeGreaterThan(1); // multiple messages
    // The text of each subsequent message (after applying our manual mrkdwn-free transform here)
    // is checked via slack.updates. Examine the SECOND chunk's last text:
    const lastForSecondTs = [...slack.updates]
      .reverse()
      .find((u) => u.ts === "2.0");
    expect(lastForSecondTs?.text.startsWith("```python\n")).toBe(true);
  });

  it("continuation chunk re-opens a fence without language when none was specified", async () => {
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 60,
      minIntervalMs: 0,
    });
    const fullText = "```\n" + "abcdefghij\n".repeat(10) + "```";
    s.append(fullText);
    await s.finish();
    expect(slack.posts.length).toBeGreaterThan(1);
    const second = [...slack.updates].reverse().find((u) => u.ts === "2.0");
    expect(second?.text.startsWith("```\n")).toBe(true);
  });

  it("finish() is idempotent and safe to call without any appends", async () => {
    const slack = makeFakeSlack();
    const s = new ChunkedMessageStream({
      ...slack,
      limit: 100,
      minIntervalMs: 0,
    });
    await s.finish();
    await s.finish();
    expect(slack.posts).toHaveLength(0);
    expect(slack.updates).toHaveLength(0);
  });
});
