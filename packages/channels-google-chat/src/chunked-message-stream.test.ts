import { describe, it, expect, vi } from "vitest";
import { ChunkedMessageStream } from "./chunked-message-stream.js";

/**
 * Build a ChunkedMessageStream wired to fake post/update fns. `minIntervalMs: 0`
 * removes throttling so flushes are deterministic. Each posted "message" is
 * given a synthetic resource name (`msg-0`, `msg-1`, …) so update calls can be
 * attributed back to a specific chunk.
 */
function makeStream(
  config: Partial<{
    limit: number;
    transform: (t: string) => string;
  }> = {},
) {
  const postPlaceholder = vi.fn(async (_text: string) => {
    const name = `msg-${postPlaceholder.mock.calls.length - 1}`;
    return name;
  });
  const updateAt = vi.fn(async (_name: string, _text: string) => {});
  const stream = new ChunkedMessageStream({
    postPlaceholder,
    updateAt,
    minIntervalMs: 0,
    limit: config.limit,
    transform: config.transform,
  });
  return { stream, postPlaceholder, updateAt };
}

/** All update calls for a given message resource name, in order. */
function updatesFor(
  updateAt: ReturnType<typeof vi.fn>,
  name: string,
): string[] {
  return (updateAt.mock.calls as any[])
    .filter((c) => (c as any[])[0] === name)
    .map((c) => (c as any[])[1] as string);
}

/** The last text pushed to a given message resource name. */
function finalTextFor(
  updateAt: ReturnType<typeof vi.fn>,
  name: string,
): string | undefined {
  const all = updatesFor(updateAt, name);
  return all.at(-1);
}

describe("ChunkedMessageStream", () => {
  it("posts a single message and updates it with the full text (under limit)", async () => {
    const { stream, postPlaceholder, updateAt } = makeStream({ limit: 100 });
    stream.append("hello world");
    await stream.finish();

    expect(postPlaceholder).toHaveBeenCalledTimes(1);
    expect(stream.chunkCount).toBe(1);
    expect(finalTextFor(updateAt, "msg-0")).toBe("hello world");
  });

  it("suppresses the message entirely when no content is ever appended", async () => {
    const { stream, postPlaceholder, updateAt } = makeStream();
    await stream.finish();

    expect(postPlaceholder).not.toHaveBeenCalled();
    expect(updateAt).not.toHaveBeenCalled();
    expect(stream.chunkCount).toBe(0);
  });

  it("suppresses the message when only empty strings are appended", async () => {
    const { stream, postPlaceholder } = makeStream();
    stream.append("");
    await stream.finish();

    expect(postPlaceholder).not.toHaveBeenCalled();
    expect(stream.chunkCount).toBe(0);
  });

  it("applies the transform to text before updating", async () => {
    const { stream, updateAt } = makeStream({
      limit: 100,
      transform: (t) => t.toUpperCase(),
    });
    stream.append("hello world");
    await stream.finish();

    expect(finalTextFor(updateAt, "msg-0")).toBe("HELLO WORLD");
  });

  it("splits long text across multiple messages and reconstructs the input", async () => {
    const limit = 20;
    const { stream, postPlaceholder, updateAt } = makeStream({ limit });

    // 5 words of ~9 chars each separated by newlines → well over the limit,
    // with break points (newlines) the chunker can freeze on.
    const input =
      "alphaword\nbetaword2\ngammaword3\ndeltaword4\nepsilonwd5\nzetaword06";
    stream.append(input);
    await stream.finish();

    expect(postPlaceholder.mock.calls.length).toBeGreaterThan(1);
    expect(stream.chunkCount).toBeGreaterThan(1);

    // Each posted chunk's final text stays within the soft limit (boundaries
    // break on newline/space at or before `limit`, leaving a chunk at most
    // `limit` chars long).
    const chunkTexts: string[] = [];
    for (let i = 0; i < stream.chunkCount; i++) {
      const txt = finalTextFor(updateAt, `msg-${i}`);
      expect(txt).toBeDefined();
      // `<= limit` is the contract; allow exactly limit.
      expect(txt!.length).toBeLessThanOrEqual(limit);
      chunkTexts.push(txt!);
    }

    // Concatenating the chunk texts reconstructs the original input exactly
    // (no transform here, boundaries partition the buffer with no gaps/overlap).
    expect(chunkTexts.join("")).toBe(input);
  });

  it("balances fences when a single code block is longer than the limit", async () => {
    const limit = 40;
    const { stream, postPlaceholder, updateAt } = makeStream({ limit });

    // One fenced block whose body alone is ~100 chars — far larger than the
    // soft limit, so the chunker is forced to split inside the fence.
    const body = "x".repeat(100);
    const input = "```ts\n" + body + "\n```";
    stream.append(input);
    await stream.finish();

    expect(postPlaceholder.mock.calls.length).toBeGreaterThan(1);
    expect(stream.chunkCount).toBeGreaterThan(1);

    const FENCE = "```";
    let reconstructedBody = "";
    for (let i = 0; i < stream.chunkCount; i++) {
      const txt = finalTextFor(updateAt, `msg-${i}`);
      expect(txt).toBeDefined();
      // Every chunk must be independently fence-balanced: an even number of
      // fences means it opens and closes its own block (no dangling fence).
      const fenceCount = txt!.split(FENCE).length - 1;
      expect(fenceCount % 2).toBe(0);
      expect(fenceCount).toBeGreaterThan(0);
      // No chunk ends with a dangling, unclosed fence (it must end on a closer).
      expect(txt!.trimEnd().endsWith(FENCE)).toBe(true);

      // Strip the injected balancing fences (leading opener + trailing closer)
      // and the original `ts` language hint, then collect the code body so we
      // can prove the original content survived the split intact.
      const inner = txt!
        .replace(/^```(?:ts)?\n?/, "")
        .replace(/\n?```\s*$/, "");
      reconstructedBody += inner;
    }

    // Concatenating the per-chunk code bodies reconstructs the original body.
    expect(reconstructedBody).toBe(body);
  });

  it("keeps already-frozen chunk boundaries stable across incremental appends", async () => {
    const limit = 20;
    const { stream, updateAt } = makeStream({ limit });

    // Append progressively longer prefixes of the same document. Once a chunk
    // boundary is frozen, the earlier chunk's text must not change as more
    // text arrives.
    const full =
      "alphaword\nbetaword2\ngammaword3\ndeltaword4\nepsilonwd5\nzetaword06";
    // Append in growing slices to force boundary freezing as content grows.
    stream.append(full.slice(0, 25));
    stream.append(full.slice(0, 45));
    stream.append(full);
    await stream.finish();

    // First chunk: every update it ever received must be a prefix of the next
    // (text only grows up to the frozen boundary, then is constant — never
    // shrinks or rewrites earlier characters).
    const firstUpdates = updatesFor(updateAt, "msg-0");
    expect(firstUpdates.length).toBeGreaterThan(0);
    const firstFinal = firstUpdates.at(-1)!;
    for (const u of firstUpdates) {
      // Each earlier update is a prefix of the final frozen first chunk.
      expect(firstFinal.startsWith(u)).toBe(true);
    }

    // And the frozen first chunk is itself a prefix of the full document
    // (boundaries partition without rewriting committed text).
    expect(full.startsWith(firstFinal)).toBe(true);
  });
});
