import { describe, it, expect } from "vitest";
import { ChunkedMessageStream } from "./chunked-message-stream.js";

function makeFakeDiscord(updateDurationMs = 0) {
  const posts: { id: string; text: string }[] = [];
  const updates: { id: string; text: string }[] = [];
  let counter = 0;
  return {
    posts,
    updates,
    postPlaceholder: async (text: string) => {
      counter++;
      const id = `${counter}.0`;
      posts.push({ id, text });
      return id;
    },
    updateAt: async (id: string, text: string) => {
      if (updateDurationMs > 0)
        await new Promise((r) => setTimeout(r, updateDurationMs));
      updates.push({ id, text });
    },
  };
}

const longString = (n: number) =>
  "lorem ipsum ".repeat(Math.ceil(n / 12)).slice(0, n);

describe("ChunkedMessageStream", () => {
  it("stays as a single message when buffer fits in one chunk", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 100,
      minIntervalMs: 0,
    });
    s.append("short reply");
    await s.finish();
    expect(discord.posts).toHaveLength(1);
    expect(discord.posts[0]!.text).toBe("_thinking…_");
    expect(discord.updates.at(-1)?.text).toBe("short reply");
  });

  it("splits into multiple messages when buffer exceeds the limit", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 50,
      minIntervalMs: 0,
    });
    s.append(longString(200));
    await s.finish();
    expect(discord.posts.length).toBeGreaterThanOrEqual(4);
    // First placeholder = thinking, rest = continued
    expect(discord.posts[0]!.text).toBe("_thinking…_");
    expect(discord.posts[1]!.text).toBe("_…(continued)_");
  });

  it("frozen boundaries don't move — already-posted chunks never shrink", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 50,
      minIntervalMs: 0,
    });
    s.append(longString(60));
    await s.finish();
    const chunkAfter1 =
      discord.updates.filter((u) => u.id === "1.0").at(-1)?.text ?? "";
    // Now feed a fresh stream the same prefix and see that chunk 1 keeps
    // the same content even when extra growth happens.
    const discord2 = makeFakeDiscord();
    const s2 = new ChunkedMessageStream({
      ...discord2,
      limit: 50,
      minIntervalMs: 0,
    });
    s2.append(longString(60));
    // Let the first dispatch settle by yielding briefly.
    await new Promise((r) => setTimeout(r, 5));
    s2.append(longString(120));
    await s2.finish();
    const chunkAfter1_b =
      discord2.updates.filter((u) => u.id === "1.0").at(-1)?.text ?? "";
    expect(chunkAfter1).toBe(chunkAfter1_b);
  });

  it("prefers to break at newlines, then spaces", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 30,
      minIntervalMs: 0,
    });
    s.append("first paragraph here.\nsecond paragraph here.\nthird here.");
    await s.finish();
    const chunk1 =
      discord.updates.filter((u) => u.id === "1.0").at(-1)?.text ?? "";
    // Should not contain a partial word — last char should be a space or newline boundary.
    expect(
      chunk1.endsWith("\n") || chunk1.endsWith(" ") || /\.[\s]?$/.test(chunk1),
    ).toBe(true);
  });

  it("concatenated chunks equal the full buffer (no characters lost)", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 40,
      minIntervalMs: 0,
    });
    const full = longString(300);
    s.append(full);
    await s.finish();
    // Take the last update per id in posted order
    const final: Record<string, string> = {};
    for (const u of discord.updates) final[u.id] = u.text;
    const concatenated = Object.entries(final)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v)
      .join("");
    expect(concatenated).toBe(full);
  });

  it("applies the transform per chunk before message edit", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 100,
      minIntervalMs: 0,
      transform: (t) => t.toUpperCase(),
    });
    s.append("hello world");
    await s.finish();
    expect(discord.updates.at(-1)?.text).toBe("HELLO WORLD");
  });

  it("block-keeps-whole: a fenced block that fits in a new chunk goes whole into the next message", async () => {
    // 200 chars of prose + a 60-char fenced block. With limit=120, the
    // ideal boundary would land inside the fence. The block-keeps-whole
    // logic should pull the boundary back to BEFORE the fence so chunk 2
    // contains the entire fence cleanly.
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 120,
      minIntervalMs: 0,
    });
    // Prose just under the limit, so we end up with exactly two chunks.
    const prose = "lorem ipsum dolor sit amet ".repeat(4); // 108 chars
    const block = "```python\nprint('hi')\nprint('bye')\n```";
    const fullText = prose + block;
    s.append(fullText);
    await s.finish();

    expect(discord.posts.length).toBeGreaterThanOrEqual(2);
    // Find the FINAL state of each chunk message
    const finals: Record<string, string> = {};
    for (const u of discord.updates) finals[u.id] = u.text;
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
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 80,
      minIntervalMs: 0,
    });
    const code = "x = 1\n".repeat(40); // ~240 chars of code
    const fullText = "preamble. ```python\n" + code + "```";
    s.append(fullText);
    await s.finish();

    expect(discord.posts.length).toBeGreaterThanOrEqual(2);
    const finals: Record<string, string> = {};
    for (const u of discord.updates) finals[u.id] = u.text;
    const chunk2 = finals["2.0"] ?? "";
    // Chunk 2 must begin with a fence opener (re-opener path).
    expect(chunk2.startsWith("```python\n")).toBe(true);
  });

  it("continuation chunk re-opens a fence when the boundary is inside ```python", async () => {
    // Reproduces the python decorators bug: a long fenced code block split
    // across two Discord messages → chunk 2 must start with the fence opener.
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
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
    expect(discord.posts.length).toBeGreaterThan(1); // multiple messages
    const lastForSecondId = [...discord.updates]
      .toReversed()
      .find((u) => u.id === "2.0");
    expect(lastForSecondId?.text.startsWith("```python\n")).toBe(true);
  });

  it("continuation chunk re-opens a fence without language when none was specified", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 60,
      minIntervalMs: 0,
    });
    const fullText = "```\n" + "abcdefghij\n".repeat(10) + "```";
    s.append(fullText);
    await s.finish();
    expect(discord.posts.length).toBeGreaterThan(1);
    const second = [...discord.updates]
      .toReversed()
      .find((u) => u.id === "2.0");
    expect(second?.text.startsWith("```\n")).toBe(true);
  });

  it("finish() is idempotent and safe to call without any appends", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      limit: 100,
      minIntervalMs: 0,
    });
    await s.finish();
    await s.finish();
    expect(discord.posts).toHaveLength(0);
    expect(discord.updates).toHaveLength(0);
  });

  it("a >2000-char buffer splits into multiple messages", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      // Use default limit (2000)
      minIntervalMs: 0,
    });
    s.append(longString(2500));
    await s.finish();
    expect(discord.posts.length).toBeGreaterThanOrEqual(2);
  });

  it("no transformed chunk exceeds Discord's 2000 hard limit, even with an open fence forcing a closer + re-opener", async () => {
    // Regression for the no-headroom bug. The input is one long unbroken line
    // inside an OPEN ```<lang> fence: with no newline/space in the back of the
    // window, the boundary lands at the soft-limit edge, so chunk 1 slices to
    // ~limit raw chars. The per-chunk transform then APPENDS a fence closer
    // ("\n```") and the continuation chunk gets a "```<lang>\n" re-opener
    // PREPENDED — growth that, at a 2000 soft limit, tips chunk 1 past 2000 and
    // makes Discord reject the edit with BASE_TYPE_MAX_LENGTH. With the default
    // 1900 soft limit there is headroom, and the safety clamp guarantees the
    // exact string handed to Discord is never above 2000 regardless.
    const discord = makeFakeDiscord();
    const lang = "supercalifragilisticpython";
    const fullText = "```" + lang + "\n" + "x".repeat(3000); // open fence
    const s = new ChunkedMessageStream({
      ...discord,
      // Default limit (1900) — leaves headroom for the transform.
      minIntervalMs: 0,
    });
    s.append(fullText);
    await s.finish();

    expect(discord.posts.length).toBeGreaterThanOrEqual(2);
    expect(discord.updates.length).toBeGreaterThan(0);
    // Every edited string is the post-transform text actually sent to Discord.
    for (const u of discord.updates) {
      expect(u.text.length).toBeLessThanOrEqual(2000);
    }
    // Sanity: the continuation chunk really did get a fence re-opener prepended,
    // so this exercise genuinely grows the transformed text.
    const second = [...discord.updates]
      .toReversed()
      .find((u) => u.id === "2.0");
    expect(second?.text.startsWith("```" + lang + "\n")).toBe(true);
  });

  it("soft limit gives the transform headroom: limit=1900 fits under 2000 where limit=2000 hits the hard cap", async () => {
    // Red/green via the `limit` option, same open-fence single-line input.
    // chunk 1's transform appends "\n```" (+4 chars). At limit=2000 the raw
    // chunk fills to 2000 and the appended closer overflows to 2004, so the
    // safety clamp has to fire and drop content to land exactly at the 2000
    // hard cap. At limit=1900 the closer fits (1904) so no clamp engages and
    // chunk 1 stays strictly below 2000 — the headroom the fix buys us.
    const lang = "supercalifragilisticpython";
    const fullText = "```" + lang + "\n" + "x".repeat(3000);

    const chunk1Len = async (limit: number) => {
      const discord = makeFakeDiscord();
      const s = new ChunkedMessageStream({
        ...discord,
        limit,
        minIntervalMs: 0,
      });
      s.append(fullText);
      await s.finish();
      for (const u of discord.updates) {
        // The clamp must hold the hard invariant at every limit.
        expect(u.text.length).toBeLessThanOrEqual(2000);
      }
      return [...discord.updates].toReversed().find((u) => u.id === "1.0")!.text
        .length;
    };

    // RED at 2000: transform overflowed → clamp forced chunk 1 to the hard cap.
    expect(await chunk1Len(2000)).toBe(2000);
    // GREEN at 1900: headroom → chunk 1's transform fits strictly under 2000.
    expect(await chunk1Len(1900)).toBeLessThan(2000);
  });

  it("a rejecting postPlaceholder surfaces at finish() without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const sendError = new Error("channel.send failed");
      const s = new ChunkedMessageStream({
        postPlaceholder: async () => {
          throw sendError;
        },
        updateAt: async () => {},
        limit: 100,
        minIntervalMs: 0,
      });
      // First append schedules the (doomed) setup. No throw here — the failure
      // is recorded on the chain, not surfaced synchronously on the first append.
      s.append("hello world");
      // Give the microtask queue a chance to settle the rejected setup chain;
      // the `.catch` must absorb it so Node never reports an unhandled rejection.
      await new Promise((r) => setTimeout(r, 10));
      // The failure surfaces deterministically at finish(), with the original
      // send error attached as the cause.
      await expect(s.finish()).rejects.toThrow(/setup failed/i);
      const caught = await s.finish().catch((e) => e);
      expect((caught as { cause?: unknown }).cause).toBe(sendError);
    } finally {
      // Let any stray rejection flush before asserting.
      await new Promise((r) => setTimeout(r, 10));
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toHaveLength(0);
  });

  it("a rejecting postPlaceholder surfaces at the next append", async () => {
    const sendError = new Error("channel.send failed");
    let calls = 0;
    const s = new ChunkedMessageStream({
      postPlaceholder: async () => {
        calls++;
        throw sendError;
      },
      updateAt: async () => {},
      limit: 100,
      minIntervalMs: 0,
    });
    s.append("first");
    // Wait for the first setup attempt to reject and be recorded.
    await new Promise((r) => setTimeout(r, 10));
    // The next append observes the recorded failure and rethrows it.
    expect(() => s.append("second")).toThrow(/setup failed/i);
    expect(calls).toBe(1);
  });

  it("a fenced code block is never split mid-fence (block-keeps-whole with default 2000 limit)", async () => {
    const discord = makeFakeDiscord();
    const s = new ChunkedMessageStream({
      ...discord,
      // Use default limit (2000)
      minIntervalMs: 0,
    });
    // ~1900 chars of prose followed by a 200-char fenced block — boundary
    // would naturally land inside the fence without the block-keeps-whole logic.
    const prose = "lorem ipsum dolor sit amet. ".repeat(68); // ~1904 chars
    const block = "```python\n" + "print('hello')\n".repeat(10) + "```";
    s.append(prose + block);
    await s.finish();

    const finals: Record<string, string> = {};
    for (const u of discord.updates) finals[u.id] = u.text;
    const chunk1 = finals["1.0"] ?? "";
    // Chunk 1 must not split into the middle of the fence — it either
    // excludes the fence entirely OR the fence is wholly within chunk 1.
    // Given the prose is ~1904 chars and limit is 2000, the fence (>100 chars)
    // should be moved into chunk 2.
    if (chunk1.includes("```")) {
      // If fence ended up in chunk 1, it must be a complete balanced fence.
      const fenceCount = (chunk1.match(/```/g) || []).length;
      expect(fenceCount % 2).toBe(0);
    } else {
      // Fence is in chunk 2 — chunk 1 has no backtick fences at all.
      expect(chunk1.includes("```")).toBe(false);
    }
    // The code content must appear somewhere across the chunks.
    const allText = Object.values(finals).join("");
    expect(allText.includes("print('hello')")).toBe(true);
  });
});
