import { describe, it, expect, vi } from "vitest";
import { createRunRenderer } from "../event-renderer.js";

describe("createRunRenderer", () => {
  it("streams text content through the edit transport", async () => {
    let id = 0;
    const edits: string[] = [];
    const r = createRunRenderer({
      postPlaceholder: async () => ++id,
      editAt: async (_mid, t) => {
        edits.push(t);
      },
    });
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "Hi" },
    } as never);
    await r.subscriber.onTextMessageEndEvent?.({
      event: { messageId: "m1" },
    } as never);
    await r.subscriber.onRunFinishedEvent?.({} as never);
    expect(edits.join("")).toContain("Hi");
  });

  it("captures tool calls", async () => {
    const r = createRunRenderer({
      postPlaceholder: async () => 1,
      editAt: async () => {},
    });
    await r.subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    await r.subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "t1" },
      toolCallName: "search",
      toolCallArgs: { q: "x" },
    } as never);
    expect(r.getCapturedToolCalls()).toEqual([
      { toolCallId: "t1", toolCallName: "search", toolCallArgs: { q: "x" } },
    ]);
  });

  it("captures a named interrupt", () => {
    const r = createRunRenderer({
      postPlaceholder: async () => 1,
      editAt: async () => {},
      interruptEventNames: new Set(["confirm"]),
    });
    r.subscriber.onCustomEvent?.({
      event: { name: "confirm", value: { foo: 1 } },
    } as never);
    expect(r.getPendingInterrupt()).toEqual({
      eventName: "confirm",
      value: { foo: 1 },
    });
  });

  it("clears a pending interrupt", () => {
    const r = createRunRenderer({
      postPlaceholder: async () => 1,
      editAt: async () => {},
      interruptEventNames: new Set(["confirm"]),
    });
    r.subscriber.onCustomEvent?.({
      event: { name: "confirm", value: { foo: 1 } },
    } as never);
    r.clearPendingInterrupt();
    expect(r.getPendingInterrupt()).toBeUndefined();
  });

  it("ignores non-matching custom events", () => {
    const r = createRunRenderer({
      postPlaceholder: async () => 1,
      editAt: async () => {},
      interruptEventNames: new Set(["confirm"]),
    });
    r.subscriber.onCustomEvent?.({
      event: { name: "other", value: { foo: 1 } },
    } as never);
    expect(r.getPendingInterrupt()).toBeUndefined();
  });

  it("parses a JSON-string interrupt value", () => {
    const r = createRunRenderer({
      postPlaceholder: async () => 1,
      editAt: async () => {},
      interruptEventNames: new Set(["confirm"]),
    });
    r.subscriber.onCustomEvent?.({
      event: { name: "confirm", value: JSON.stringify({ ok: true }) },
    } as never);
    expect(r.getPendingInterrupt()?.value).toEqual({ ok: true });
  });

  it("calls setTyping on tool start when provided", async () => {
    const setTyping = vi.fn(async () => {});
    const r = createRunRenderer({
      postPlaceholder: async () => 1,
      editAt: async () => {},
      setTyping,
    });
    await r.subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    expect(setTyping).toHaveBeenCalled();
  });

  it("posts a tool-status line when no setTyping and showToolStatus default", async () => {
    const edits: string[] = [];
    let id = 0;
    const r = createRunRenderer({
      postPlaceholder: async () => ++id,
      editAt: async (_mid, t) => {
        edits.push(t);
      },
    });
    await r.subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    await r.subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "t1" },
      toolCallName: "search",
      toolCallArgs: {},
    } as never);
    // postPlaceholder was called for the status line (id advanced from 0)
    expect(id).toBeGreaterThan(0);
    // onToolCallEndEvent edits the status message to show ✅ search
    expect(edits.some((t) => t.includes("search"))).toBe(true);
    expect(r.getCapturedToolCalls()).toHaveLength(1);
  });

  it("does not post tool status when showToolStatus is false but still captures", async () => {
    let id = 0;
    const posts: number[] = [];
    const r = createRunRenderer({
      postPlaceholder: async () => {
        posts.push(++id);
        return id;
      },
      editAt: async () => {},
      showToolStatus: false,
    });
    await r.subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    await r.subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "t1" },
      toolCallName: "search",
      toolCallArgs: {},
    } as never);
    expect(posts).toHaveLength(0);
    expect(r.getCapturedToolCalls()).toHaveLength(1);
  });

  it("markInterrupted appends an interrupted suffix to a partial reply", async () => {
    let id = 0;
    const edits: string[] = [];
    const r = createRunRenderer({
      postPlaceholder: async () => ++id,
      editAt: async (_mid, t) => {
        edits.push(t);
      },
    });
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "Once upon a time" },
    } as never);
    await r.markInterrupted();
    const last = edits.at(-1) ?? "";
    expect(last).toContain("Once upon a time");
    expect(last).toContain("(interrupted)");
  });

  it("markInterrupted with no partial reply posts nothing", async () => {
    const posts: number[] = [];
    let id = 0;
    const r = createRunRenderer({
      postPlaceholder: async () => {
        posts.push(++id);
        return id;
      },
      editAt: async () => {},
    });
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    await r.markInterrupted();
    expect(posts).toHaveLength(0);
  });

  it("delivers content for a reused messageId after START→END→START", async () => {
    let id = 0;
    const posts: number[] = [];
    // Track the final VISIBLE text per message id. A post() seeds the visible
    // state with the placeholder text; each edit() overwrites it. At the end,
    // the visible state of every message id must be its real content — never a
    // bare "…" left behind by an un-edited placeholder.
    const visibleByMid = new Map<number, string>();
    const r = createRunRenderer({
      postPlaceholder: async (text) => {
        const mid = ++id;
        posts.push(mid);
        visibleByMid.set(mid, text);
        return mid;
      },
      editAt: async (mid, t) => {
        visibleByMid.set(mid, t);
      },
    });
    // First message lifecycle for m1.
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "First" },
    } as never);
    await r.subscriber.onTextMessageEndEvent?.({
      event: { messageId: "m1" },
    } as never);
    // Same messageId reused for a second message (legal across steps). This
    // START must flush the first message before resetting.
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "Second" },
    } as never);
    await r.subscriber.onTextMessageEndEvent?.({
      event: { messageId: "m1" },
    } as never);
    await r.subscriber.onRunFinishedEvent?.({} as never);

    const finalVisible = Array.from(visibleByMid.values());
    // BOTH messages must be delivered — neither content is dropped.
    expect(finalVisible.some((t) => t.includes("First"))).toBe(true);
    expect(finalVisible.some((t) => t.includes("Second"))).toBe(true);
    // Two placeholders were posted (one per message).
    expect(posts.length).toBe(2);
    // Every posted message id has a final visible state captured.
    expect(visibleByMid.size).toBe(posts.length);
    // The final visible state of EVERY message id must be real content — no
    // message is left showing the bare eager "…" placeholder. (This is the
    // load-bearing assertion: it now reflects post() seeding + edit()
    // overwrites, so a placeholder that was never edited would still read "…"
    // here and fail.)
    expect(finalVisible.every((t) => t.trim() !== "…")).toBe(true);
  });

  it("markInterrupted leaves no bare placeholder when interrupt races the in-flight post (orphan-race)", async () => {
    let id = 0;
    const posts: string[] = [];
    // Final visible text per message id: post() seeds it with the placeholder,
    // edit() overwrites. The regression invariant is that after a racing
    // interrupt, no message id is left showing the bare "…".
    const visibleByMid = new Map<number, string>();
    let resolvePost: (() => void) | undefined;
    const r = createRunRenderer({
      // Delay the placeholder post so it is STILL IN FLIGHT when the interrupt
      // arrives — this is the orphan race: content was appended (queued on the
      // stream's setupPromise) but the placeholder post hasn't settled, so
      // stream.chunkCount is still 0 at interrupt time.
      postPlaceholder: (text) =>
        new Promise<number>((resolve) => {
          const mid = ++id;
          posts.push(text);
          visibleByMid.set(mid, text);
          resolvePost = () => resolve(mid);
        }),
      editAt: async (mid, t) => {
        visibleByMid.set(mid, t);
      },
    });
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    // Content appended — schedules the placeholder post on setupPromise, but
    // we do NOT let it resolve before interrupting.
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "Half a sentence" },
    } as never);

    // Kick off the interrupt while the placeholder post is still pending, then
    // release the post so finish() can flush it deterministically.
    const interrupt = r.markInterrupted();
    // Allow the queued setupPromise microtasks to reach the pending post.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolvePost).toBeDefined();
    resolvePost?.();
    await interrupt;

    // A placeholder was posted for the in-flight stream.
    expect(posts.length).toBeGreaterThan(0);
    // No message id is left showing the bare "…": the in-flight placeholder was
    // created-and-flushed (edited to the partial content + interrupted marker)
    // rather than abandoned.
    const finalVisible = Array.from(visibleByMid.values());
    expect(finalVisible.every((t) => t.trim() !== "…")).toBe(true);
    expect(finalVisible.some((t) => t.includes("Half a sentence"))).toBe(true);
    expect(finalVisible.some((t) => t.includes("interrupted"))).toBe(true);
  });

  it("markInterrupted clears a stray placeholder when buffer is empty/whitespace", async () => {
    let id = 0;
    const posts: string[] = [];
    // Final visible text per message id: post() seeds it with the placeholder,
    // edit() overwrites it. A whitespace-only buffer gets NO interrupted marker
    // (there is no real content to mark) — but its eager placeholder must still
    // be finished/flushed so the bare "…" doesn't linger.
    const visibleByMid = new Map<number, string>();
    const r = createRunRenderer({
      postPlaceholder: async (text) => {
        const mid = ++id;
        posts.push(text);
        visibleByMid.set(mid, text);
        return mid;
      },
      editAt: async (mid, t) => {
        visibleByMid.set(mid, t);
      },
    });
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    // Whitespace-only content still eagerly posts a placeholder via the stream.
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: " " },
    } as never);
    // Let the eager placeholder post resolve.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts.length).toBeGreaterThan(0);
    await r.markInterrupted();
    // The eager placeholder must have been finished/flushed (edited away from
    // the bare "…") rather than abandoned in the chat.
    const finalVisible = Array.from(visibleByMid.values());
    expect(finalVisible.every((t) => t.trim() !== "…")).toBe(true);
  });

  it("onRunFinishedEvent swallows a terminal-edit rejection (best-effort)", async () => {
    let id = 0;
    const r = createRunRenderer({
      postPlaceholder: async () => ++id,
      // Reject every edit, including the terminal flush.
      editAt: async () => {
        throw new Error("message is not modified");
      },
    });
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "Hi" },
    } as never);
    await r.subscriber.onTextMessageEndEvent?.({
      event: { messageId: "m1" },
    } as never);
    // Must resolve, not reject — a finish rejection is caught/logged.
    await expect(
      r.subscriber.onRunFinishedEvent?.({} as never),
    ).resolves.toBeUndefined();
  });

  it("onRunErrorEvent swallows a terminal-edit rejection while still posting the error notice", async () => {
    let id = 0;
    const posts: string[] = [];
    const r = createRunRenderer({
      postPlaceholder: async (text) => {
        posts.push(text);
        return ++id;
      },
      // Reject every edit, including the terminal flush from stream.finish().
      editAt: async () => {
        throw new Error("message is not modified");
      },
    });
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "Partial" },
    } as never);
    // Must resolve, not reject — the stream.finish() rejection must be caught.
    await expect(
      r.subscriber.onRunErrorEvent?.({
        event: { message: "agent crashed" },
      } as never),
    ).resolves.toBeUndefined();
    // The error notice must still have been posted.
    expect(posts.some((t) => t.includes("agent crashed"))).toBe(true);
  });

  it("markInterrupted drains an in-flight tool-status placeholder (START with no END)", async () => {
    let id = 0;
    const posts: string[] = [];
    const edits: Array<{ mid: number; text: string }> = [];
    const r = createRunRenderer({
      postPlaceholder: async (text) => {
        posts.push(text);
        return ++id;
      },
      editAt: async (mid, text) => {
        edits.push({ mid, text });
      },
    });
    // Tool call starts (posts "🔧 using search…") but never ends.
    await r.subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    expect(posts.some((t) => t.includes("using search"))).toBe(true);
    const statusMid = id;

    await r.markInterrupted();

    // The placeholder must have been edited away — not left as "🔧 using …".
    const drainEdit = edits.find((e) => e.mid === statusMid);
    expect(drainEdit).toBeDefined();
    expect(drainEdit?.text).not.toContain("using search");
    expect(drainEdit?.text).toContain("search");
    expect(drainEdit?.text).toContain("cancelled");

    // toolStatusIds is empty: a late END for the same id is a no-op (the map
    // was drained, so no further edit is issued for that placeholder).
    const editsBefore = edits.length;
    await r.subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "t1" },
      toolCallName: "search",
      toolCallArgs: {},
    } as never);
    expect(edits.length).toBe(editsBefore);
  });

  it("onRunErrorEvent drains an in-flight tool-status placeholder (START with no END)", async () => {
    let id = 0;
    const posts: string[] = [];
    const edits: Array<{ mid: number; text: string }> = [];
    const r = createRunRenderer({
      postPlaceholder: async (text) => {
        posts.push(text);
        return ++id;
      },
      editAt: async (mid, text) => {
        edits.push({ mid, text });
      },
    });
    // Tool call starts (posts "🔧 using search…") but never ends.
    await r.subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    expect(posts.some((t) => t.includes("using search"))).toBe(true);
    const statusMid = id;

    await r.subscriber.onRunErrorEvent?.({
      event: { message: "boom" },
    } as never);

    // The orphaned placeholder must have been edited to a terminal marker.
    const drainEdit = edits.find((e) => e.mid === statusMid);
    expect(drainEdit).toBeDefined();
    expect(drainEdit?.text).not.toContain("using search");
    expect(drainEdit?.text).toContain("search");
    expect(drainEdit?.text).toContain("cancelled");

    // The error notice is still posted.
    expect(posts.some((t) => t.includes("boom"))).toBe(true);

    // toolStatusIds is empty: a late END for the same id issues no edit.
    const editsBefore = edits.length;
    await r.subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "t1" },
      toolCallName: "search",
      toolCallArgs: {},
    } as never);
    expect(edits.length).toBe(editsBefore);
  });

  it("onRunErrorEvent finalizes an in-flight stream before posting the error notice", async () => {
    let id = 0;
    const edits: string[] = [];
    const posts: string[] = [];
    const r = createRunRenderer({
      postPlaceholder: async (text) => {
        posts.push(text);
        return ++id;
      },
      editAt: async (_mid, t) => {
        edits.push(t);
      },
    });
    // Start a text message and emit some content (no TEXT_MESSAGE_END yet)
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as never);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "Partial reply" },
    } as never);
    // Fire a run error before the message ends
    await r.subscriber.onRunErrorEvent?.({
      event: { message: "something went wrong" },
    } as never);
    // The partial stream must have been flushed (an edit containing the content)
    expect(edits.some((t) => t.includes("Partial reply"))).toBe(true);
    // The error notice must have been posted after the flush
    expect(posts.some((t) => t.includes("something went wrong"))).toBe(true);
    // Error notice is the last post (streams flushed first, then notice)
    const lastPost = posts.at(-1) ?? "";
    expect(lastPost).toContain("something went wrong");
  });
});
