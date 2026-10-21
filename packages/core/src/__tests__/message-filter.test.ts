import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, RunAgentInput } from "@ag-ui/client";
import { EMPTY } from "rxjs";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore } from "../core";
import * as messageFilterModule from "../core/message-filter";
import {
  ɵkeepToolResultsWithCalls,
  ɵrepairToolCallPairs,
} from "../core/message-filter";
import {
  createSuggestionsConfig,
  waitForCondition,
  createAssistantMessage,
  createMultipleToolCallsMessage,
  createMessage,
  createToolCallMessage,
  createToolResultMessage,
  getToolMessage,
} from "./test-utils";

const encoder = new TextEncoder();

function createSseResponse(): Response {
  const events = [
    { type: "RUN_STARTED", threadId: "test-thread", runId: "test-run" },
    {
      type: "RUN_FINISHED",
      threadId: "test-thread",
      runId: "test-run",
      result: { newMessages: [] },
    },
  ];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function infoResponse(): Response {
  return new Response(
    JSON.stringify({
      version: "1.0.0",
      agents: {
        default: {
          name: "default",
          className: "HttpAgent",
          description: "assistant",
        },
      },
      audioFileTranscriptionEnabled: false,
      mode: "sse",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function toolCallIdsOf(message: Message): string[] {
  const calls = (message as { toolCalls?: { id: string }[] }).toolCalls ?? [];
  return calls.map((call) => call.id);
}

function toolCallIdOf(message: Message): string {
  const calls = (message as { toolCalls?: { id: string }[] }).toolCalls;
  if (!calls?.[0]) throw new Error("message carries no tool call");
  return calls[0].id;
}

/** The messages that actually went on the wire for a REST run request. */
function sentMessages(init: RequestInit): Message[] {
  return JSON.parse(init.body as string).messages;
}

describe("ɵrepairToolCallPairs", () => {
  it("restores the assistant call in front of a kept tool result", () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const full = [createMessage({ id: "u1" }), call, result];

    const repaired = ɵrepairToolCallPairs([result], full);

    // Dropping the result would be valid but would throw away the only new
    // information in a human-in-the-loop turn.
    expect(repaired.map((m) => m.id)).toEqual([call.id, result.id]);
  });

  it("restores every sibling result when it restores a parallel call", () => {
    const call = createMultipleToolCallsMessage([
      { name: "lookupA" },
      { name: "lookupB" },
    ]);
    const [callA, callB] = toolCallIdsOf(call);
    const resultA = createToolResultMessage(callA!, "a");
    const resultB = createToolResultMessage(callB!, "b");
    const full = [call, resultA, resultB];

    // Keeping only the second result: a provider rejects the turn unless the
    // first call is answered too.
    const repaired = ɵrepairToolCallPairs([resultB], full);

    expect(repaired.map((m) => m.id)).toEqual([
      call.id,
      resultA.id,
      resultB.id,
    ]);
  });

  it.each([true, false])(
    "preserves a retained result's edits when its call is kept: %s",
    (keepCall) => {
      const call = createToolCallMessage("lookup");
      const result = createToolResultMessage(toolCallIdOf(call), "secret");
      const redacted = { ...getToolMessage(result), content: "[REDACTED]" };
      const kept = keepCall ? [structuredClone(call), redacted] : [redacted];

      const repaired = ɵrepairToolCallPairs(kept, [call, result]);

      expect(repaired).toEqual([call, redacted]);
      expect(repaired[1]).toBe(redacted);
      expect(result.content).toBe("secret");
    },
  );

  it("preserves a retained result's edits while restoring its call and sibling", () => {
    const call = createMultipleToolCallsMessage([
      { name: "lookupA" },
      { name: "lookupB" },
    ]);
    const [callA, callB] = toolCallIdsOf(call);
    const resultA = createToolResultMessage(callA!, "a");
    const resultB = createToolResultMessage(callB!, "secret");
    const redacted = { ...getToolMessage(resultB), content: "[REDACTED]" };

    const repaired = ɵrepairToolCallPairs([redacted], [call, resultA, resultB]);

    expect(repaired).toEqual([call, resultA, redacted]);
    expect(repaired[1]).toBe(resultA);
    expect(repaired[2]).toBe(redacted);
  });

  it("restores the result of a kept call, directly after the call", () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const followUp = createAssistantMessage({ id: "a2" });
    const full = [createMessage({ id: "u1" }), call, result, followUp];

    const repaired = ɵrepairToolCallPairs([call, followUp], full);

    expect(repaired.map((m) => m.id)).toEqual([call.id, result.id, "a2"]);
  });

  it("leaves an open call alone when no result exists yet", () => {
    // Mid-HITL: the call is awaiting a human, so the pair is not broken.
    const call = createToolCallMessage("askUser");
    const full = [createMessage({ id: "u1" }), call];

    const repaired = ɵrepairToolCallPairs([call], full);

    expect(repaired.map((m) => m.id)).toEqual([call.id]);
  });

  it("keeps a tool result whose issuing call is not in this thread", () => {
    // No issuer to reason about, so dropping it would be the client inventing
    // a rule the backend never stated.
    const orphan = createToolResultMessage("call-from-elsewhere", "done");
    const full = [createMessage({ id: "u1" }), orphan];

    const repaired = ɵrepairToolCallPairs([orphan], full);

    expect(repaired.map((m) => m.id)).toEqual([orphan.id]);
  });

  it("emits an intact call and result once each, in the filter's order", () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const full = [call, result];

    const repaired = ɵrepairToolCallPairs([call, result], full);

    expect(repaired.map((m) => m.id)).toEqual([call.id, result.id]);
  });

  it("returns the same messages in the same order when the filter kept everything", () => {
    const full = [
      createMessage({ id: "u1" }),
      createAssistantMessage({ id: "a1" }),
    ];

    expect(ɵrepairToolCallPairs(full, full)).toEqual(full);
  });
});

const userMsg = (id: string) => ({ id, role: "user", content: id }) as Message;
const textMsg = (id: string) =>
  ({ id, role: "assistant", content: id }) as Message;
const callsMsg = (id: string, ...callIds: string[]) =>
  ({
    id,
    role: "assistant",
    content: "",
    toolCalls: callIds.map((callId) => ({
      id: callId,
      type: "function",
      function: { name: "f", arguments: "{}" },
    })),
  }) as Message;
const toolMsg = (id: string, callId: string) =>
  ({ id, role: "tool", toolCallId: callId, content: id }) as Message;
const reasoningMsg = (id: string) =>
  ({ id, role: "reasoning", content: id }) as Message;
const activityMsg = (id: string) =>
  ({ id, role: "activity", activityType: "x", content: {} }) as never;
const withRun = (message: Message, subagentRunId: string) =>
  ({ ...message, subagentRunId }) as Message;

// mulberry32: a tiny seeded PRNG, so every run checks the same histories
// and a failure reproduces from its seed.
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const roleOf = (message: Message) =>
  (message as { role?: string } | null)?.role;
const slotOf = (m: Message) => (m as unknown as { slot: number }).slot;
// Null and array entries are transparent: like activity, never an anchor.
const isEntry = (message: Message) =>
  message !== null && !Array.isArray(message);
// An issuer position and a result's call id: one call slot group.
const keyOf = (issuerSlot: number, result: Message) =>
  JSON.stringify([issuerSlot, (result as { toolCallId?: string }).toolCallId]);

describe("ɵkeepToolResultsWithCalls", () => {
  it("moves a detached result back behind its call (the snapshot-merge shape)", () => {
    const u = userMsg("u");
    const a1 = callsMsg("a1", "c");
    const a2 = textMsg("a2");
    const t = toolMsg("t", "c");

    expect(ɵkeepToolResultsWithCalls([u, a1, a2, t])).toEqual([u, a1, t, a2]);
  });

  it("returns the very same array for a well-formed thread", () => {
    const thread = [
      userMsg("u1"),
      callsMsg("a1", "c1", "c2"),
      toolMsg("t1", "c1"),
      activityMsg("act"),
      toolMsg("t2", "c2"),
      textMsg("a2"),
    ];

    expect(ɵkeepToolResultsWithCalls(thread)).toBe(thread);
  });

  it("never moves an early result past an answered call onto a later pending one", () => {
    const thread = [
      toolMsg("t0", "c"),
      callsMsg("a1", "c"),
      toolMsg("t1", "c"),
      userMsg("u2"),
      callsMsg("a2", "c"),
    ];

    expect(ɵkeepToolResultsWithCalls(thread)).toBe(thread);
  });

  it("leaves results in place when call ids are reused across turns", () => {
    const thread = [
      userMsg("u1"),
      callsMsg("a1", "call_0"),
      toolMsg("t1", "call_0"),
      textMsg("x1"),
      userMsg("u2"),
      callsMsg("a2", "call_0"),
      toolMsg("t2", "call_0"),
      textMsg("x2"),
    ];

    expect(ɵkeepToolResultsWithCalls(thread)).toBe(thread);
  });

  it("pairs several detached results for one reused id from the newest back, keeping stored order per call", () => {
    const a1 = callsMsg("A1", "c");
    const a2 = callsMsg("A2", "c");
    const x = textMsg("X");
    const t1 = toolMsg("T1", "c");
    const t2 = toolMsg("T2", "c");

    // Taken from the newest result back: T2 answers the newest open call (A2),
    // then T1 the next one back (A1), so stored order is kept per call.
    expect(ɵkeepToolResultsWithCalls([a1, a2, x, t1, t2])).toEqual([
      a1,
      t1,
      a2,
      t2,
      x,
    ]);
  });

  it("keeps each turn's result in its own turn when a snapshot detached every result of a reused id", () => {
    // A snapshot that re-ids every tool message appends both results at the
    // end. Nearest-first would hand T1 to A2 and T2 to A1, swapping the turns.
    const u1 = userMsg("U1");
    const a1 = callsMsg("A1", "call_0");
    const a1t = textMsg("A1t");
    const u2 = userMsg("U2");
    const a2 = callsMsg("A2", "call_0");
    const a2t = textMsg("A2t");
    const t1 = toolMsg("T1", "call_0");
    const t2 = toolMsg("T2", "call_0");

    expect(
      ɵkeepToolResultsWithCalls([u1, a1, a1t, u2, a2, a2t, t1, t2]),
    ).toEqual([u1, a1, t1, a1t, u2, a2, t2, a2t]);
  });

  it("sends a duplicate result for an answered call to an older abandoned call with that id", () => {
    // The rule cannot tell a duplicate from a detached answer: a0 is still
    // open when t1dup is seen, so t1dup moves behind a0, across a user turn.
    // That keeps every call answered at most once, but it is not where the
    // duplicate came from; it is documented here, not endorsed.
    const a0 = callsMsg("a0", "c");
    const u = userMsg("u");
    const a1 = callsMsg("a1", "c");
    const t1 = toolMsg("t1", "c");
    const x = textMsg("x");
    const t1dup = toolMsg("t1dup", "c");

    expect(ɵkeepToolResultsWithCalls([a0, u, a1, t1, x, t1dup])).toEqual([
      a0,
      t1dup,
      u,
      a1,
      t1,
      x,
    ]);
  });

  it("treats a null entry as transparent between a call and its result", () => {
    const a1 = callsMsg("a1", "c");
    const hole = null as unknown as Message;
    const t1 = toolMsg("t1", "c");
    const thread = [a1, hole, t1];

    expect(ɵkeepToolResultsWithCalls(thread)).toBe(thread);
  });

  it("never anchors on a null entry, and leaves it in place when a result moves", () => {
    const a = callsMsg("a", "c");
    const hole = null as unknown as Message;
    const x = textMsg("x");
    const t = toolMsg("t", "c");

    expect(ɵkeepToolResultsWithCalls([a, x, hole, t])).toEqual([a, t, x, hole]);
    expect(ɵkeepToolResultsWithCalls([a, hole, x, t])).toEqual([a, hole, t, x]);
  });

  it("treats one object appearing twice as two independent slots", () => {
    const a = callsMsg("a", "c");
    const t = toolMsg("t", "c");
    const x1 = textMsg("x1");
    const x2 = textMsg("x2");

    const out = ɵkeepToolResultsWithCalls([a, x1, t, a, x2, t]);

    expect(out).toHaveLength(6);
    [a, t, x1, a, t, x2].forEach((message, index) =>
      expect(out[index]).toBe(message),
    );
  });

  it("moves a result stored before its call forward, directly behind the call", () => {
    const u = userMsg("u");
    const t = toolMsg("t", "c");
    const a1 = callsMsg("a1", "c");
    const x = textMsg("x");

    expect(ɵkeepToolResultsWithCalls([u, t, a1, x])).toEqual([u, a1, t, x]);
  });

  it("moves a result forward past reasoning stored before its call", () => {
    const u = userMsg("u");
    const t = toolMsg("t", "c");
    const r = reasoningMsg("r");
    const a = callsMsg("a", "c");

    expect(ɵkeepToolResultsWithCalls([u, t, r, a])).toEqual([u, r, a, t]);
  });

  it("never moves a result forward onto a call that a later in-place result answers", () => {
    const thread = [toolMsg("t1", "c"), callsMsg("a", "c"), toolMsg("t2", "c")];

    expect(ɵkeepToolResultsWithCalls(thread)).toBe(thread);
  });

  it("keeps an early result in place when the next call for its id is already answered", () => {
    const thread = [
      toolMsg("t0", "c"),
      callsMsg("a1", "c"),
      toolMsg("t1", "c"),
      callsMsg("a2", "c"),
      callsMsg("a3", "c"),
    ];

    // Skipping the answered a1 would hand t0 to a2, a call that may still be
    // pending, so t0 stays.
    expect(ɵkeepToolResultsWithCalls(thread)).toBe(thread);
  });

  it("moves no early result forward when its call id is reused across turns", () => {
    // c appears on a1 and a2. Nothing says which call t0 and t1 answer, and
    // a2 may be a pending human-in-the-loop call, so neither moves.
    const thread = [
      toolMsg("t0", "c"),
      toolMsg("t1", "c"),
      callsMsg("a1", "c"),
      userMsg("u"),
      callsMsg("a2", "c"),
    ];

    expect(ɵkeepToolResultsWithCalls(thread)).toBe(thread);
  });

  it("moves an early result forward behind a re-id'd assistant whose call id is unique", () => {
    const u = userMsg("u");
    const t = toolMsg("t", "c1");
    const x = textMsg("x");
    const a1 = callsMsg("a1", "c1");

    const out = ɵkeepToolResultsWithCalls([u, t, x, a1]);
    expect(out).toHaveLength(4);
    [u, x, a1, t].forEach((message, index) => expect(out[index]).toBe(message));
  });

  it("moves only the first of two early results for one unique call forward", () => {
    const t1 = toolMsg("t1", "c");
    const t2 = toolMsg("t2", "c");
    const a = callsMsg("a", "c");

    const out = ɵkeepToolResultsWithCalls([t1, t2, a]);
    expect(out).toHaveLength(3);
    [t2, a, t1].forEach((message, index) => expect(out[index]).toBe(message));
  });

  it("keeps an extra result for an answered call in place instead of moving it forward to a later open call", () => {
    const a = callsMsg("a", "c");
    const t1 = toolMsg("t1", "c");
    const t2 = toolMsg("t2", "c");
    const x = textMsg("x");
    const a2 = callsMsg("a2", "c");
    const thread = [a, t1, t2, x, a2];

    expect(ɵkeepToolResultsWithCalls(thread)).toBe(thread);
  });

  it("never answers a later pending call with a stale result for an earlier answered call that reused its id", () => {
    // t1 answers a1's call_0, so t1dup is an extra result for a call that
    // already has one. a2 reuses call_0 and is still pending (a frontend
    // tool, an interrupt, a human-in-the-loop call waiting on the user).
    // Moving t1dup forward would answer a2 with a1's result.
    const thread = [
      userMsg("u1"),
      callsMsg("a1", "call_0"),
      toolMsg("t1", "call_0"),
      textMsg("x"),
      toolMsg("t1dup", "call_0"),
      userMsg("u2"),
      callsMsg("a2", "call_0"),
    ];

    expect(ɵkeepToolResultsWithCalls(thread)).toBe(thread);
  });

  it("leaves detached results that find no open earlier call in place, never moving them forward", () => {
    // t3 takes the one earlier call. t1 and t2 had an earlier call for their
    // id too, so they are extras, not early results, and stay put rather
    // than answer a2 and a3.
    const a = callsMsg("a", "c");
    const x = textMsg("x");
    const t1 = toolMsg("t1", "c");
    const t2 = toolMsg("t2", "c");
    const t3 = toolMsg("t3", "c");
    const a2 = callsMsg("a2", "c");
    const a3 = callsMsg("a3", "c");

    expect(ɵkeepToolResultsWithCalls([a, x, t1, t2, t3, a2, a3])).toEqual([
      a,
      t3,
      x,
      t1,
      t2,
      a2,
      a3,
    ]);
  });

  it("moves a drifted result behind its subagent call even when the result carries no subagentRunId", () => {
    // Results CopilotKit creates itself (frontend tool results, interrupt
    // responses) carry no subagentRunId, and a result's run may differ from
    // its call's, so pairing is by call id alone.
    const u = userMsg("u");
    const s = withRun(callsMsg("s", "c"), "r1");
    const x = textMsg("x");
    const t = toolMsg("t", "c");

    expect(ɵkeepToolResultsWithCalls([u, s, x, t])).toEqual([u, s, t, x]);
  });

  it("cannot tell apart a parent and a subagent call that reuse one id (known limitation)", () => {
    // Pairing is by id alone. Both results drifted; newest back, t (the
    // parent's) takes the newest open call (s, the subagent's) and ts takes
    // a. Each call is answered once, but the two results are swapped.
    const u = userMsg("u");
    const a = callsMsg("a", "c");
    const s = withRun(callsMsg("s", "c"), "r1");
    const x = textMsg("x");
    const ts = withRun(toolMsg("ts", "c"), "r1");
    const t = toolMsg("t", "c");

    expect(ɵkeepToolResultsWithCalls([u, a, s, x, ts, t])).toEqual([
      u,
      a,
      ts,
      s,
      t,
      x,
    ]);
  });

  it("treats an array entry as transparent, like null: never the anchor", () => {
    const a = callsMsg("a", "c");
    const nested = [] as unknown as Message;
    const x = textMsg("x");
    const t = toolMsg("t", "c");

    const between = [a, nested, t];
    expect(ɵkeepToolResultsWithCalls(between)).toBe(between);
    expect(ɵkeepToolResultsWithCalls([a, x, nested, t])).toEqual([
      a,
      t,
      x,
      nested,
    ]);
  });

  it("keeps the stored order of the results it moves behind one call", () => {
    const a1 = callsMsg("a1", "c1", "c2");
    const x = textMsg("x");
    const t1 = toolMsg("t1", "c1");
    const t2 = toolMsg("t2", "c2");
    expect(ɵkeepToolResultsWithCalls([a1, x, t1, t2])).toEqual([a1, t1, t2, x]);
    expect(ɵkeepToolResultsWithCalls([a1, x, t2, t1])).toEqual([a1, t2, t1, x]);

    // Ids are matched one at a time, newest result first, so the collected
    // order here is t3, t1, t2; only sorting gives back the stored order.
    const a = callsMsg("a", "c1", "c1", "c2");
    const t3 = toolMsg("t3", "c1");
    expect(ɵkeepToolResultsWithCalls([a, x, t1, t2, t3])).toEqual([
      a,
      t1,
      t2,
      t3,
      x,
    ]);
  });

  it("keeps both detached results for one call, moving only the later one behind it", () => {
    const a = callsMsg("a", "c");
    const x = textMsg("x");
    const t1 = toolMsg("t1", "c");
    const t2 = toolMsg("t2", "c");

    // Detached results are matched from the newest back, so t2 takes the one
    // slot and moves; t1 has nothing left to answer and stays. Which of two
    // indistinguishable results answers is arbitrary; both are kept.
    expect(ɵkeepToolResultsWithCalls([a, x, t1, t2])).toEqual([a, t2, x, t1]);
  });

  it("moves a result past reasoning stored between it and its call, but not past activity", () => {
    const u = userMsg("u");
    const a = callsMsg("a", "c");
    const r = reasoningMsg("r");
    const t = toolMsg("t", "c");
    expect(ɵkeepToolResultsWithCalls([u, a, r, t])).toEqual([u, a, t, r]);

    const viaActivity = [u, a, activityMsg("act"), t];
    expect(ɵkeepToolResultsWithCalls(viaActivity)).toBe(viaActivity);
  });

  it("places a moved result after the results already following its call", () => {
    const a = callsMsg("a", "c1", "c2");
    const t1 = toolMsg("t1", "c1");
    const act = activityMsg("act");
    const x = textMsg("x");
    const t2 = toolMsg("t2", "c2");

    expect(ɵkeepToolResultsWithCalls([a, t1, act, x, t2])).toEqual([
      a,
      t1,
      act,
      t2,
      x,
    ]);
  });

  it("skips malformed entries instead of throwing, and passes them through", () => {
    const u = userMsg("u");
    const odd = {
      id: "odd",
      role: "assistant",
      toolCalls: [null, 5, { id: 3 }, { id: "c" }],
    } as unknown as Message;
    const notArray = {
      id: "na",
      role: "assistant",
      toolCalls: "nope",
    } as unknown as Message;
    const x = textMsg("x");
    const t = toolMsg("t", "c");
    const noCallId = { id: "t?", role: "tool" } as unknown as Message;
    const hole = null as unknown as Message;

    const thread = [u, odd, notArray, x, hole, noCallId, t];
    const out = ɵkeepToolResultsWithCalls(thread);

    expect(out).toEqual([u, odd, t, notArray, x, hole, noCallId]);

    const untouched = [u, hole, notArray, noCallId, x];
    expect(ɵkeepToolResultsWithCalls(untouched)).toBe(untouched);
  });

  describe("properties over random histories", () => {
    const SEED = 0x7877;
    const RUNS = 4000;
    const MAX_LENGTH = 14;
    const ID_POOL = ["c0", "c1", "c2"];
    const RUN_POOL = [undefined, undefined, "r1", "r2"];

    const randomHistory = (random: () => number): Message[] => {
      const pick = <T>(items: T[]) =>
        items[Math.floor(random() * items.length)]!;
      const inRun = (message: Message) => {
        const run = pick(RUN_POOL);
        return run === undefined ? message : withRun(message, run);
      };
      const length = Math.floor(random() * (MAX_LENGTH + 1));
      const history: Message[] = [];
      for (let index = 0; index < length; index++) {
        // Re-insert an earlier entry (same reference) a fifth of the time.
        if (history.length > 0 && random() < 0.2) {
          history.push(pick(history));
          continue;
        }
        const id = `m${index}`;
        const kind = random();
        if (kind < 0.12) history.push(userMsg(id));
        else if (kind < 0.4) {
          const count = Math.floor(random() * 4);
          const ids = Array.from({ length: count }, () => pick(ID_POOL));
          history.push(inRun(callsMsg(id, ...ids)));
        } else if (kind < 0.48) history.push(textMsg(id));
        else if (kind < 0.55) history.push(reasoningMsg(id));
        else if (kind < 0.72) history.push(inRun(toolMsg(id, pick(ID_POOL))));
        else if (kind < 0.8) {
          // A burst of results for one reused id, the shape a snapshot that
          // re-ids every tool message leaves at the end of the thread.
          const callId = pick(ID_POOL);
          const count = 2 + Math.floor(random() * 2);
          for (let burst = 0; burst < count; burst++) {
            history.push(inRun(toolMsg(`${id}.${burst}`, callId)));
          }
        } else if (kind < 0.86) {
          // A result stored before the call it answers. The two runs are
          // drawn independently: pairing ignores them.
          const callId = pick(ID_POOL);
          history.push(
            inRun(toolMsg(`${id}.t`, callId)),
            inRun(callsMsg(`${id}.a`, callId)),
          );
        } else if (kind < 0.92) history.push(activityMsg(id));
        else if (kind < 0.96) history.push(null as unknown as Message);
        else history.push([] as unknown as Message);
      }
      return history;
    };

    const isBoundary = (message: Message) =>
      isEntry(message) &&
      roleOf(message) !== "tool" &&
      roleOf(message) !== "activity";
    const counts = (messages: Message[]) => {
      const tally = new Map<Message, number>();
      for (const m of messages) tally.set(m, (tally.get(m) ?? 0) + 1);
      return tally;
    };
    /** For each position, the index of the last boundary at or before it. */
    const anchorsOf = (messages: Message[]) => {
      let anchor = -1;
      return messages.map((m, index) =>
        isBoundary(m) ? (anchor = index) : anchor,
      );
    };

    const histories = (() => {
      const random = prng(SEED);
      return Array.from({ length: RUNS }, () => randomHistory(random));
    })();

    it("never adds, drops, or duplicates a message", () => {
      for (const history of histories) {
        const out = ɵkeepToolResultsWithCalls(history);
        expect(out).toHaveLength(history.length);
        expect(counts(out)).toEqual(counts(history));
      }
    });

    it("keeps every non-tool message in its relative order", () => {
      for (const history of histories) {
        const out = ɵkeepToolResultsWithCalls(history);
        const before = history.filter((m) => roleOf(m) !== "tool");
        const after = out.filter((m) => roleOf(m) !== "tool");
        expect(after).toHaveLength(before.length);
        before.forEach((m, index) => expect(after[index]).toBe(m));
      }
    });

    it("is idempotent", () => {
      for (const history of histories) {
        const once = ɵkeepToolResultsWithCalls(history);
        const twice = ɵkeepToolResultsWithCalls(once);
        expect(twice).toBe(once);
      }
    });

    it("returns the input itself whenever nothing moved", () => {
      for (const history of histories) {
        const out = ɵkeepToolResultsWithCalls(history);
        const unchanged = out.every((m, index) => m === history[index]);
        if (unchanged) expect(out).toBe(history);
        else expect(out).not.toBe(history);
      }
    });

    /**
     * Run on slot-tagged copies, so every input position is a distinct
     * object, and report which input positions moved. A tool result moved
     * exactly when the boundary it sits behind changed; this reads only the
     * output, never re-derives which call a result should answer.
     */
    const runTagged = (history: Message[]) => {
      const tagged = history.map((m, slot) =>
        isEntry(m) ? ({ ...m, slot } as unknown as Message) : m,
      );
      const out = ɵkeepToolResultsWithCalls(tagged);
      const inAnchors = anchorsOf(tagged);
      const outAnchors = anchorsOf(out);
      const moved = new Set<number>();
      out.forEach((m, index) => {
        if (roleOf(m) !== "tool") return;
        const before = inAnchors[slotOf(m)]!;
        const after = outAnchors[index]!;
        const issuer = after === -1 ? undefined : out[after];
        if (issuer !== (before === -1 ? undefined : tagged[before])) {
          moved.add(slotOf(m));
        }
      });
      return { tagged, out, inAnchors, outAnchors, moved };
    };

    /**
     * How many calls `issuer` makes for the result's call id. The subagent
     * run of either side never matters.
     */
    const callsFor = (issuer: Message, result: Message) =>
      roleOf(issuer) === "assistant"
        ? toolCallIdsOf(issuer).filter(
            (id) => id === (result as { toolCallId?: string }).toolCallId,
          ).length
        : 0;

    /**
     * Per issuer and key, how many results moved in behind it, and how many
     * of its slots were answered in place (the first results for the key
     * stored behind it, up to its call count).
     */
    const slotUse = (history: Message[]) => {
      const { tagged, out, inAnchors, outAnchors, moved } = runTagged(history);
      const movedIn = new Map<string, number>();
      const inPlace = new Map<string, number>();
      const calls = new Map<string, number>();
      out.forEach((m, index) => {
        if (!isEntry(m) || !moved.has(slotOf(m))) return;
        const issuer = out[outAnchors[index]!]!;
        const key = keyOf(slotOf(issuer), m);
        movedIn.set(key, (movedIn.get(key) ?? 0) + 1);
        calls.set(key, callsFor(issuer, m));
      });
      const behind = new Map<string, number>();
      tagged.forEach((m, slot) => {
        if (roleOf(m) !== "tool" || inAnchors[slot] === -1) return;
        const issuer = tagged[inAnchors[slot]!]!;
        const key = keyOf(inAnchors[slot]!, m);
        behind.set(key, (behind.get(key) ?? 0) + 1);
        const limit = callsFor(issuer, m);
        inPlace.set(key, Math.min(behind.get(key)!, limit));
      });
      return { movedIn, inPlace, calls };
    };

    it("pairs by position, giving the same order whether or not entries alias each other", () => {
      for (const history of histories) {
        const { out } = runTagged(history);
        expect(out.map((m) => (isEntry(m) ? history[slotOf(m)] : m))).toEqual(
          ɵkeepToolResultsWithCalls(history),
        );
      }
    });

    it("leaves exactly the input behind once the moved results are taken out", () => {
      for (const history of histories) {
        const { tagged, out, moved } = runTagged(history);
        const outWithoutMoved = out.filter(
          (m) => !isEntry(m) || !moved.has(slotOf(m)),
        );
        const inWithoutMoved = tagged.filter((_, slot) => !moved.has(slot));
        expect(outWithoutMoved).toHaveLength(inWithoutMoved.length);
        inWithoutMoved.forEach((m, index) =>
          expect(outWithoutMoved[index]).toBe(m),
        );
      }
    });

    it("lands every moved result directly behind an assistant call for its id, with only tool or transparent entries between", () => {
      for (const history of histories) {
        const { out, outAnchors, moved } = runTagged(history);
        out.forEach((m, index) => {
          if (!isEntry(m) || !moved.has(slotOf(m))) return;
          const anchor = outAnchors[index]!;
          expect(anchor).toBeGreaterThanOrEqual(0);
          // anchorsOf picks the last boundary, so everything between the
          // issuer and the result is tool, activity, or a transparent entry.
          for (let between = anchor + 1; between < index; between++) {
            if (!isEntry(out[between]!)) continue;
            expect(["tool", "activity"]).toContain(roleOf(out[between]!));
          }
          expect(callsFor(out[anchor]!, m)).toBeGreaterThan(0);
        });
      }
    });

    it("moves a result forward only when its call id is on exactly one call slot, issued after it", () => {
      let movedForward = 0;
      for (const history of histories) {
        const { tagged, out, outAnchors, moved } = runTagged(history);
        out.forEach((m, index) => {
          if (!isEntry(m) || !moved.has(slotOf(m))) return;
          const issuerSlot = slotOf(out[outAnchors[index]!]!);
          if (issuerSlot < slotOf(m)) return;
          movedForward++;
          // Exactly one call slot for its id in the whole history, issued
          // after the result: a reused id never moves forward.
          let slotsForId = 0;
          for (const entry of tagged) {
            if (isEntry(entry)) slotsForId += callsFor(entry, m);
          }
          expect(slotsForId).toBe(1);
          expect(issuerSlot).toBeGreaterThan(slotOf(m));
        });
      }
      // Forward moves still happen: the generator produces unique-id results
      // stored before their call.
      expect(movedForward).toBeGreaterThan(0);
    });

    it("never answers one slot twice by moves", () => {
      for (const history of histories) {
        const { movedIn, calls } = slotUse(history);
        for (const [key, count] of movedIn) {
          expect(count).toBeLessThanOrEqual(calls.get(key)!);
        }
      }
    });

    it("moves every result onto a slot that was open, never one answered in place", () => {
      for (const history of histories) {
        const { movedIn, inPlace, calls } = slotUse(history);
        for (const [key, count] of movedIn) {
          expect(count + (inPlace.get(key) ?? 0)).toBeLessThanOrEqual(
            calls.get(key)!,
          );
        }
      }
    });

    it("keeps the stored order of the results moved behind one issuer", () => {
      for (const history of histories) {
        const { out, outAnchors, moved } = runTagged(history);
        const lastSlot = new Map<number, number>();
        out.forEach((m, index) => {
          if (!isEntry(m) || !moved.has(slotOf(m))) return;
          const issuer = outAnchors[index]!;
          const previous = lastSlot.get(issuer);
          if (previous !== undefined) {
            expect(slotOf(m)).toBeGreaterThan(previous);
          }
          lastSlot.set(issuer, slotOf(m));
        });
      }
    });
  });
});

describe("ProxiedCopilotRuntimeAgent messageFilter", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(createSseResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  const history = (): Message[] => [
    createMessage({ id: "u1", content: "first" }),
    createAssistantMessage({ id: "a1" }),
    createMessage({ id: "u2", content: "latest" }),
  ];

  it("sends the whole thread when no filter is set", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
    });
    agent.setMessages(history());

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("sends only what the filter kept", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u2"]);
  });

  it("leaves the rendered transcript at full length", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());

    await agent.runAgent();

    expect(agent.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("repairs the tool-call pair a blunt filter would have split", async () => {
    // The #1482 failure in reverse: trimming to the last message on a thread
    // that ends in a tool result leaves the provider a result with no call.
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages([createMessage({ id: "u1" }), call, result]);

    await agent.runAgent();

    // The call comes back, the earlier user turn stays trimmed. Sending `[]`
    // here would hand a resuming backend nothing to act on.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual([call.id, result.id]);
  });

  it("restores a dropped result so a kept call is never left unanswered", async () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.filter((m) => m.role !== "tool"),
    });
    agent.setMessages([createMessage({ id: "u1" }), call, result]);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual([
      "u1",
      call.id,
      result.id,
    ]);
  });

  it.each([
    ["rest", "run"],
    ["rest", "connect"],
    ["single", "run"],
    ["single", "connect"],
  ] as const)(
    "preserves tool-result redaction on %s %s without changing the transcript",
    async (transport, operation) => {
      const call = createToolCallMessage("lookup");
      const result = createToolResultMessage(toolCallIdOf(call), "secret");
      const thread = [createMessage({ id: "u1" }), call, result];
      const agent = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: "https://runtime.example",
        agentId: "a",
        transport,
        messageFilter: (messages) =>
          messages
            .filter((m) => m.role === "tool")
            .map((m) => ({ ...m, content: "[REDACTED]" })),
      });
      agent.setMessages(thread);
      let transcriptAtDispatch: Message[] | undefined;
      fetchMock.mockImplementation(() => {
        // connect resets local messages when processing the response, so
        // inspect the transcript before any backend events are applied.
        transcriptAtDispatch = structuredClone(agent.messages);
        return Promise.resolve(createSseResponse());
      });

      if (operation === "run") await agent.runAgent();
      else await agent.connectAgent();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string);
      if (transport === "single") {
        expect(payload.method).toBe(`agent/${operation}`);
      } else {
        expect(url).toContain(`/${operation}`);
      }
      const sent =
        transport === "single" ? payload.body.messages : payload.messages;
      expect(sent).toEqual([call, { ...result, content: "[REDACTED]" }]);
      expect(transcriptAtDispatch).toEqual(thread);
      expect(result.content).toBe("secret");
    },
  );

  it("trims below run(), so the transport fork never hands a delegate a trimmed thread", async () => {
    // Placement is the Intelligence exemption. `run()` is the fork between the
    // HTTP transports and the Intelligence delegate, and the delegate forwards
    // whatever input it is handed. So the input reaching `run()` must still be
    // the whole thread; only the HTTP branch below it may narrow the payload.
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());
    const run = vi.spyOn(agent, "run");

    await agent.runAgent();

    expect(run.mock.calls[0]?.[0].messages.map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u2",
    ]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u2"]);
  });

  it.each([
    ["auto", { transport: "auto" as const }],
    ["pending", { runtimeMode: "pending" as const }],
  ])(
    "never trims for a delegate when the mode resolves to Intelligence after the input was prepared (%s)",
    async (_label, overrides) => {
      // The regression this guards: `runAgent` prepares the input, and only
      // THEN does `run()` resolve `/info`. With the default "auto" transport,
      // or on a proxy still "pending" its first `/info`, an earlier revision
      // had already filtered by that point and handed the truncated thread to
      // the managed runtime — which is the store of record for that thread.
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: "1.0.0",
              mode: "intelligence",
              intelligence: { wsUrl: "wss://intelligence.example/ws" },
              audioFileTranscriptionEnabled: false,
              agents: { a: { name: "a", className: "HttpAgent" } },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      );
      const agent = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: "https://runtime.example",
        agentId: "a",
        messageFilter: (messages) => messages.slice(-1),
        ...overrides,
      });
      agent.setMessages(history());

      let delegateSaw: string[] | undefined;
      // Stub only the delegate construction: the mode resolution and the
      // filter — the things under test — still run for real.
      (
        agent as unknown as { resolveDelegate: () => Promise<unknown> }
      ).resolveDelegate = async () => ({
        run: (input: RunAgentInput) => {
          delegateSaw = input.messages.map((m) => m.id);
          return EMPTY;
        },
      });

      await agent.runAgent().catch(() => undefined);

      expect(delegateSaw).toEqual(["u1", "a1", "u2"]);
    },
  );

  it("falls back to the full thread when the filter returns an array as an entry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      // The shape a `messages.map((m) => [m])` mistake produces: every entry
      // is an object to `typeof`, but none is a message.
      messageFilter: (messages) => messages.map((m) => [m]) as never,
    });
    agent.setMessages(history());

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "messageFilter returned an entry that is not a message",
      ),
    );
  });

  it("falls back to the full thread when the filter smuggles in a non-message entry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      // The shape a `messages.map((m) => (keep(m) ? m : undefined))` mistake
      // produces, where `filter` was meant.
      messageFilter: () => [undefined as never],
    });
    agent.setMessages(history());

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    // The filter produced the bad entry, so the filter is what gets blamed.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "messageFilter returned an entry that is not a message",
      ),
    );
  });

  it("leaves Intelligence runs untrimmed, because that runtime is the store of record", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      runtimeMode: "intelligence",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());
    const run = vi.spyOn(agent, "run").mockReturnValue(EMPTY);

    await agent.runAgent().catch(() => undefined);

    expect(run.mock.calls[0]?.[0].messages.map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u2",
    ]);
  });

  it("tells the filter which agent is running", async () => {
    const seen: string[] = [];
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "billing-agent",
      transport: "rest",
      messageFilter: (messages, context) => {
        seen.push(context.agentId);
        return messages;
      },
    });
    agent.setMessages(history());

    await agent.runAgent();

    expect(seen).toEqual(["billing-agent"]);
  });

  it("hides activity messages from the filter", async () => {
    const seen: Message[][] = [];
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => {
        seen.push(messages);
        return messages;
      },
    });
    agent.setMessages([
      createMessage({ id: "u1" }),
      createMessage({ id: "act1", role: "activity" } as never),
      createMessage({ id: "u2" }),
    ]);

    await agent.runAgent();

    expect(seen[0]?.map((m) => m.id)).toEqual(["u1", "u2"]);
  });

  it("cannot corrupt the repair baseline by mutating a message it drops", async () => {
    // The filter is handed its own deep copy. Sharing the message objects with
    // `input.messages` — which is both the repair baseline and the untrimmed
    // fallback — let a filter that rewrote a dropped message's tool call hide
    // the issuer from the repair, and the kept tool result then went out
    // orphaned: a payload the provider rejects.
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => {
        const issuer = messages.find((m) => m.role === "assistant") as {
          toolCalls?: { id: string }[];
        };
        if (issuer?.toolCalls?.[0]) issuer.toolCalls[0].id = "rewritten";
        return messages.filter((m) => m.role === "tool");
      },
    });
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    agent.setMessages([createMessage({ id: "u1" }), call, result]);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = sentMessages(init);
    expect(sent.map((m) => m.id)).toEqual([call.id, result.id]);
    expect(toolCallIdsOf(sent[0]!)).toEqual([toolCallIdOf(call)]);
  });

  it("cannot corrupt the transcript by mutating the array it is handed", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => {
        messages.length = 0;
        (messages as { push: (m: Message) => void }).push(
          createMessage({ id: "injected" }),
        );
        return messages;
      },
    });
    agent.setMessages(history());

    await agent.runAgent();

    expect(agent.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  it("falls back to the full thread when the filter returns a non-array", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (() => undefined) as never,
    });
    agent.setMessages(history());

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("messageFilter returned a non-array value"),
    );
  });

  it("falls back to the full thread when the filter throws", async () => {
    // Trimming is an optimization. A bug in it must not take the user's
    // message down with it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: () => {
        throw new Error("boom");
      },
    });
    agent.setMessages(history());

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("messageFilter failed"),
      expect.any(Error),
    );
  });

  it("does not blame the filter when copying the thread for it fails", async () => {
    // The stored thread carries an activity message, so the copy made for the
    // filter is the first clone of an activity-free array holding u1: that is
    // the one forced to fail.
    const realClone = globalThis.structuredClone;
    let armed = true;
    vi.spyOn(globalThis, "structuredClone").mockImplementation(((
      value: unknown,
      options?: StructuredSerializeOptions,
    ) => {
      if (
        armed &&
        Array.isArray(value) &&
        value.some((m) => (m as Message | null)?.id === "u1") &&
        !value.some((m) => (m as Message | null)?.role === "activity")
      ) {
        armed = false;
        throw new Error("clone bug");
      }
      return realClone(value, options);
    }) as typeof structuredClone);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filter = vi.fn((messages: Message[]) => messages.slice(-1));
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: filter,
    });
    agent.setMessages([...history(), activityMsg("act")]);

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    expect(armed).toBe(false);
    expect(filter).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("could not copy the message history"),
      expect.any(Error),
    );
  });

  it("blames the tool-call repair, not a filter that worked, and still sends the filter's output when the repair throws", async () => {
    // Forced through the module export: the repair failing is what is under
    // test, independent of which malformed input happens to trip it.
    const repair = vi
      .spyOn(messageFilterModule, "ɵrepairToolCallPairs")
      .mockImplementation(() => {
        throw new Error("repair bug");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) =>
        messages
          .slice(-1)
          .map((m) => ({ ...m, content: "redacted" }) as Message),
    });
    agent.setMessages(history());

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    expect(repair).toHaveBeenCalledTimes(1);
    // The filter worked, so its output goes out with its edits; only the
    // filter repair on top of it is replaced by the move-only pass.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = sentMessages(init);
    expect(sent.map((m) => m.id)).toEqual(["u2"]);
    expect(sent[0]!.content).toBe("redacted");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('tool-call repair failed for agent "a"'),
      expect.any(Error),
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("messageFilter failed"),
      expect.anything(),
    );
  });

  it("still re-pairs a drifted result in the filter's output, keeping its edits, when the filter repair throws", async () => {
    vi.spyOn(messageFilterModule, "ɵrepairToolCallPairs").mockImplementation(
      () => {
        throw new Error("repair bug");
      },
    );
    const keep = vi.spyOn(messageFilterModule, "ɵkeepToolResultsWithCalls");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      // Trims the first message and redacts the rest.
      messageFilter: (messages) =>
        messages
          .slice(1)
          .map((m) => ({ ...m, content: "redacted" }) as Message),
    });
    const call = createToolCallMessage("lookup");
    const after = createAssistantMessage({ id: "after", content: "text" });
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    agent.setMessages([createMessage({ id: "u1" }), call, after, result]);

    await agent.runAgent();

    expect(keep).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = sentMessages(init);
    expect(sent.map((m) => m.id)).toEqual([call.id, result.id, after.id]);
    expect(sent.map((m) => m.content)).toEqual([
      "redacted",
      "redacted",
      "redacted",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('tool-call repair failed for agent "a"'),
      expect.any(Error),
    );
  });

  it("sends the filter's output as is when both the filter repair and the move-only fallback throw", async () => {
    vi.spyOn(messageFilterModule, "ɵrepairToolCallPairs").mockImplementation(
      () => {
        throw new Error("repair bug");
      },
    );
    vi.spyOn(
      messageFilterModule,
      "ɵkeepToolResultsWithCalls",
    ).mockImplementation(() => {
      throw new Error("move bug");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) =>
        messages
          .slice(1)
          .map((m) => ({ ...m, content: "redacted" }) as Message),
    });
    const call = createToolCallMessage("lookup");
    const after = createAssistantMessage({ id: "after", content: "text" });
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    agent.setMessages([createMessage({ id: "u1" }), call, after, result]);

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = sentMessages(init);
    expect(sent.map((m) => m.id)).toEqual([call.id, after.id, result.id]);
    expect(sent.every((m) => m.content === "redacted")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('tool-call repair failed for agent "a"'),
      expect.any(Error),
      expect.any(Error),
    );
  });

  it("still sends the thread when both the filter and the repair throw", async () => {
    // A failed filter falls back to the full thread, which takes the
    // unfiltered path, so that is the step forced to throw here.
    const repair = vi.spyOn(messageFilterModule, "ɵrepairToolCallPairs");
    const keep = vi
      .spyOn(messageFilterModule, "ɵkeepToolResultsWithCalls")
      .mockImplementation(() => {
        throw new Error("repair bug");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: () => {
        throw new Error("filter bug");
      },
    });
    agent.setMessages(history());

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining("messageFilter failed"),
      expect.stringContaining("tool-call repair failed"),
    ]);
    expect(keep).toHaveBeenCalledTimes(1);
    expect(repair).not.toHaveBeenCalled();
  });

  it("applies a filter assigned after construction", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
    });
    agent.setMessages(history());
    agent.messageFilter = (messages) => messages.slice(-1);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u2"]);
  });

  it("survives clone(), which the runtime does once per run", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());

    const cloned = agent.clone();
    await cloned.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u2"]);
  });

  it("trims the payload on the single-route transport too", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "single",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const envelope = JSON.parse(init.body as string);
    expect(envelope.body.messages.map((m: Message) => m.id)).toEqual(["u2"]);
  });

  it("does not put back a result whose call the filter redacted from its copy", async () => {
    // The filter decides what a kept message looks like. Stripping the calls
    // from an assistant turn (and their results with it) is a valid, paired
    // payload, so the repair must not resurrect the results from the store.
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "secret");
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) =>
        messages
          .filter((m) => m.role !== "tool")
          .map((m) =>
            m.role === "assistant" ? { ...m, toolCalls: undefined } : m,
          ),
    });
    agent.setMessages([
      createMessage({ id: "u1" }),
      call,
      createAssistantMessage({ id: "a2" }),
      result,
    ]);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = sentMessages(init);
    expect(sent.map((m) => m.id)).toEqual(["u1", call.id, "a2"]);
    expect(sent.some((m) => m.role === "tool")).toBe(false);
  });

  it("never sends a message twice under an identity filter, even with a shared id", async () => {
    // The filter hands back clones, so they cannot be matched to the store by
    // reference; a kept call must not also be restored from the store.
    const call = createToolCallMessage("lookup", {}, { id: "x" });
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages,
    });
    agent.setMessages([
      createMessage({ id: "u1" }),
      call,
      result,
      createAssistantMessage({ id: "x", content: "same id" }),
    ]);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = sentMessages(init);
    // ɵrepairToolCallPairs de-duplicates by message id, so the text message
    // that shares the call's id ("same id") is not sent: a known limitation
    // of the filter repair. Nothing is sent twice, which is what this test
    // guards.
    expect(sent.map((m) => [m.id, m.role])).toEqual([
      ["u1", "user"],
      ["x", "assistant"],
      [result.id, "tool"],
    ]);
    expect(toolCallIdsOf(sent[1]!)).toEqual([toolCallIdOf(call)]);
  });

  it("routes a filter's output through the filter repair, not the unfiltered move", async () => {
    const keep = vi.spyOn(messageFilterModule, "ɵkeepToolResultsWithCalls");
    const repair = vi.spyOn(messageFilterModule, "ɵrepairToolCallPairs");
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      messageFilter: (messages) => messages.slice(-1),
    });
    agent.setMessages(history());

    await agent.runAgent();

    expect(repair).toHaveBeenCalledTimes(1);
    expect(keep).not.toHaveBeenCalled();
  });

  it("falls back to the full thread when the filter returns a sparse array", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
      // eslint-disable-next-line no-sparse-arrays
      messageFilter: (messages) => [messages[0]!, , messages[2]!] as Message[],
    });
    agent.setMessages(history());

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not a message"));
  });
});

describe("ProxiedCopilotRuntimeAgent tool-call pairing without a filter", () => {
  // The client store can hold a tool result detached from its call: when the
  // streamed TOOL_CALL_RESULT and the backend's MESSAGES_SNAPSHOT carry the
  // tool message under different ids, the snapshot merge drops the streamed
  // copy (placed after its call) and appends the snapshot's copy at the tail.
  // A backend rebuilding its state from that payload drops the result it
  // cannot pair, so every unfiltered send moves detached results back behind
  // their call (and changes nothing else).
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(createSseResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  const agentWith = (messages: Message[]) => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "rest",
    });
    agent.setMessages(messages);
    return agent;
  };

  /** A store whose tool result was pushed past the reply that followed it. */
  const detached = () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const reply = createAssistantMessage({ id: "a2" });
    return {
      call,
      result,
      messages: [createMessage({ id: "u1" }), call, reply, result],
    };
  };

  it("puts a detached tool result back directly after its call", async () => {
    const { call, result, messages } = detached();
    const agent = agentWith(messages);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual([
      "u1",
      call.id,
      result.id,
      "a2",
    ]);
  });

  it("re-pairs on the connect request too", async () => {
    const { call, result, messages } = detached();
    const agent = agentWith(messages);

    await agent.connectAgent().catch(() => undefined);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/connect");
    expect(sentMessages(init).map((m) => m.id)).toEqual([
      "u1",
      call.id,
      result.id,
      "a2",
    ]);
  });

  it("re-pairs every result of a parallel call", async () => {
    const call = createMultipleToolCallsMessage([
      { name: "lookupA" },
      { name: "lookupB" },
    ]);
    const [callA, callB] = toolCallIdsOf(call);
    const resultA = createToolResultMessage(callA!, "a");
    const resultB = createToolResultMessage(callB!, "b");
    const agent = agentWith([
      createMessage({ id: "u1" }),
      call,
      resultB,
      createAssistantMessage({ id: "a2" }),
      resultA,
    ]);

    await agent.runAgent();

    // resultB already sits behind the call and stays; the detached resultA
    // joins it there, after the results already in place.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual([
      "u1",
      call.id,
      resultB.id,
      resultA.id,
      "a2",
    ]);
  });

  it("sends a well-formed thread exactly as stored", async () => {
    const call = createToolCallMessage("lookup");
    const result = createToolResultMessage(toolCallIdOf(call), "done");
    const messages = [
      createMessage({ id: "u1" }),
      call,
      result,
      createAssistantMessage({ id: "a2" }),
      createMessage({ id: "u2" }),
    ];
    const agent = agentWith(messages);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init)).toEqual(messages);
  });

  it("leaves an open call alone", async () => {
    const call = createToolCallMessage("approve");
    const agent = agentWith([createMessage({ id: "u1" }), call]);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["u1", call.id]);
  });

  it("still re-pairs the full thread a broken filter falls back to", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { call, result, messages } = detached();
    const agent = agentWith(messages);
    agent.messageFilter = () => {
      throw new Error("boom");
    };

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual([
      "u1",
      call.id,
      result.id,
      "a2",
    ]);
  });

  it("still re-pairs the full thread a non-array filter result falls back to", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { call, result, messages } = detached();
    const agent = agentWith(messages);
    agent.messageFilter = (() => "not an array") as never;

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual([
      "u1",
      call.id,
      result.id,
      "a2",
    ]);
  });

  it("re-pairs on the single-route connect request too", async () => {
    const { call, result, messages } = detached();
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "single",
    });
    agent.setMessages(messages);

    await agent.connectAgent().catch(() => undefined);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const envelope = JSON.parse(init.body as string);
    expect(envelope.method).toBe("agent/connect");
    expect(envelope.body.messages.map((m: Message) => m.id)).toEqual([
      "u1",
      call.id,
      result.id,
      "a2",
    ]);
  });

  it("re-pairs on the single-route run request too", async () => {
    const { call, result, messages } = detached();
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "single",
    });
    agent.setMessages(messages);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const envelope = JSON.parse(init.body as string);
    expect(envelope.method).toBe("agent/run");
    expect(envelope.body.messages.map((m: Message) => m.id)).toEqual([
      "u1",
      call.id,
      result.id,
      "a2",
    ]);
  });

  it("sends every stored message, even two that share an id", async () => {
    // The unfiltered step works by position, so a duplicated id (a re-seeded
    // store, a backend that reuses ids) is never mistaken for a repeat.
    const { call, result, messages } = detached();
    const dupe = createMessage({ id: "u1", content: "again" });
    const agent = agentWith([...messages, dupe]);

    await agent.runAgent();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual([
      "u1",
      call.id,
      result.id,
      "a2",
      "u1",
    ]);
  });

  it("sends a malformed stored thread as-is instead of failing the run", async () => {
    // A persisted or hand-built message can carry a null entry in its
    // toolCalls. The unfiltered pairing step skips entries it cannot read
    // rather than throwing, so a thread the transport would accept is never
    // lost to it. The single-route transport is used because it forwards the
    // payload without schema validation, so this thread reaches the wire.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const malformed = createAssistantMessage({
      id: "a1",
      toolCalls: [null] as never,
    });
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "a",
      transport: "single",
    });
    agent.setMessages([
      createMessage({ id: "u1" }),
      malformed,
      createMessage({ id: "u2" }),
    ]);

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const envelope = JSON.parse(init.body as string);
    expect(envelope.body.messages.map((m: Message) => m.id)).toEqual([
      "u1",
      "a1",
      "u2",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("calls the pairing step through the module export, so a spy on it intercepts the send", async () => {
    // The throw tests force a failure by mocking this export. That only
    // proves anything if agent.ts reaches the step through the same binding
    // the spy replaces; this pins that it does.
    const sentinel = [createMessage({ id: "from-spy" })];
    const keep = vi
      .spyOn(messageFilterModule, "ɵkeepToolResultsWithCalls")
      .mockReturnValue(sentinel);
    const { messages } = detached();
    const agent = agentWith(messages);

    await agent.runAgent();

    expect(keep).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(sentMessages(init).map((m) => m.id)).toEqual(["from-spy"]);
  });

  it("warns once, naming the repair, and sends the input unchanged when the repair throws", async () => {
    // Forced through the module export: no known input makes it throw.
    const keep = vi
      .spyOn(messageFilterModule, "ɵkeepToolResultsWithCalls")
      .mockImplementation(() => {
        throw new Error("repair bug");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { call, result, messages } = detached();
    const agent = agentWith(messages);

    await expect(agent.runAgent()).resolves.toMatchObject({
      newMessages: expect.any(Array),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(keep).toHaveBeenCalledTimes(1);
    expect(sentMessages(init).map((m) => m.id)).toEqual([
      "u1",
      call.id,
      "a2",
      result.id,
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('tool-call repair failed for agent "a"'),
      expect.any(Error),
    );
  });
});

describe("CopilotKitCore messageFilter reaches runtime-discovered agents", () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as { window?: unknown }).window;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("/info") ? infoResponse() : createSseResponse(),
        ),
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    // The core only opens its `/info` connection in a browser.
    (global as { window?: unknown }).window = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (global as { window?: unknown }).window;
    } else {
      (global as { window?: unknown }).window = originalWindow;
    }
  });

  const runRequestBody = (): Message[] => {
    // `endsWith`, not `includes`: the `/info` URL contains "/runtime.example".
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/run"),
    ) as [string, RequestInit];
    return sentMessages(call[1]);
  };

  it("trims the payload of an agent the runtime advertised", async () => {
    // The case #1482 reporters actually have: no agent instance of their own,
    // just `<CopilotKit runtimeUrl>` and an agent discovered from `/info`.
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      messageFilter: (messages) => messages.slice(-1),
    });
    await waitForCondition(() => Boolean(core.getAgent("default")));

    const agent = core.getAgent("default")!;
    agent.setMessages([
      createMessage({ id: "u1" }),
      createAssistantMessage({ id: "a1" }),
      createMessage({ id: "u2" }),
    ]);
    await agent.runAgent();

    expect(runRequestBody().map((m) => m.id)).toEqual(["u2"]);
  });

  it("applies a filter set after the agent was discovered", async () => {
    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => Boolean(core.getAgent("default")));

    core.setMessageFilter((messages) => messages.slice(-1));

    const agent = core.getAgent("default")!;
    agent.setMessages([
      createMessage({ id: "u1" }),
      createMessage({ id: "u2" }),
    ]);
    await agent.runAgent();

    expect(runRequestBody().map((m) => m.id)).toEqual(["u2"]);
  });

  it("goes back to the full thread when the filter is cleared", async () => {
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      messageFilter: (messages) => messages.slice(-1),
    });
    await waitForCondition(() => Boolean(core.getAgent("default")));

    core.setMessageFilter(undefined);

    const agent = core.getAgent("default")!;
    agent.setMessages([
      createMessage({ id: "u1" }),
      createMessage({ id: "u2" }),
    ]);
    await agent.runAgent();

    expect(runRequestBody().map((m) => m.id)).toEqual(["u1", "u2"]);
  });
});

describe("messageFilter and suggestions", () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as { window?: unknown }).window;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // No `suggestions` capability advertised, so the engine takes the
    // clone + runAgent fallback rather than the stateless /suggest path.
    fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/info")
          ? new Response(
              JSON.stringify({
                version: "1.0.0",
                mode: "sse",
                audioFileTranscriptionEnabled: false,
                agents: {
                  default: { name: "default", className: "HttpAgent" },
                  consumer: { name: "consumer", className: "HttpAgent" },
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          : createSseResponse(),
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    (global as { window?: unknown }).window = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (global as { window?: unknown }).window;
    } else {
      (global as { window?: unknown }).window = originalWindow;
    }
  });

  it("keeps the seeded context on a suggestion run", async () => {
    // A suggestion clone runs under a fresh thread id, so no backend store can
    // fill in what a filter withheld: the seeded messages ARE the context. If
    // the app's filter rode the clone, the provider would be asked to suggest
    // from a single message.
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      messageFilter: (messages) => messages.slice(-1),
    });
    await waitForCondition(() => Boolean(core.getAgent("consumer")));

    core
      .getAgent("consumer")!
      .setMessages([
        createMessage({ id: "c1", content: "first" }),
        createAssistantMessage({ id: "c2" }),
        createMessage({ id: "c3", content: "latest" }),
      ]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        providerAgentId: "default",
        consumerAgentId: "consumer",
      }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/agent/default/run"),
        ),
      ).toBe(true);
    });

    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/agent/default/run"),
    ) as [string, RequestInit];
    // Trimmed, this would be exactly one message.
    expect(sentMessages(call[1]).length).toBeGreaterThan(1);
  });
});
