/**
 * Thread ownership inside InMemoryAgentRunner, tested on the runner itself.
 * The HTTP routes are covered by `__tests__/thread-access.test.ts`.
 */
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { from } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadAccessDeniedError } from "../agent-runner";
import {
  InMemoryAgentRunner,
  ɵGLOBAL_STORE,
  ɵINMEMORY_DEFAULTS,
} from "../in-memory";
import {
  OwnershipTestAgent,
  collect,
  ownershipInput,
  ownershipThreadId,
} from "./ownership-test-agent";

const ALICE = { ownerId: "alice" };
const BOB = { ownerId: "bob" };

/** Hanging runs started by a test; released in afterEach so none leaks. */
const hanging: OwnershipTestAgent[] = [];

afterEach(() => {
  for (const agent of hanging.splice(0)) agent.release();
});

async function startHanging(
  runner: InMemoryAgentRunner,
  threadId: string,
  ownerId: string,
  secret: string,
) {
  const agent = new OwnershipTestAgent(true);
  hanging.push(agent);
  const input = ownershipInput(threadId, secret);
  agent.setMessages(input.messages);
  const done = collect(runner.run({ threadId, agent, input, ownerId }));
  await agent.whenStarted();
  return { agent, done };
}

function runToEnd(
  runner: InMemoryAgentRunner,
  threadId: string,
  ownerId: string,
  secret: string,
) {
  const agent = new OwnershipTestAgent();
  const input = ownershipInput(threadId, secret);
  agent.setMessages(input.messages);
  return collect(runner.run({ threadId, agent, input, ownerId }));
}

describe("stored message history across runs", () => {
  type Sent = { id: string; content: unknown; role?: string };

  /** An agent run through the real event reducer of AbstractAgent. */
  class ScriptedAgent extends AbstractAgent {
    constructor(
      private readonly script: (input: RunAgentInput) => BaseEvent[] = () => [],
    ) {
      super();
    }
    clone(): ScriptedAgent {
      return new ScriptedAgent(this.script);
    }
    run(input: RunAgentInput): Observable<BaseEvent> {
      const { threadId, runId } = input;
      return from([
        { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent,
        ...this.script(input),
        { type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent,
      ]);
    }
  }

  const messagesSnapshot = (messages: unknown[]) =>
    ({ type: EventType.MESSAGES_SNAPSHOT, messages }) as unknown as BaseEvent;

  /** Echoes its input through MESSAGES_SNAPSHOT, normalized by `normalize`. */
  const normalizingAgent = (normalize: (m: Message) => unknown) =>
    new ScriptedAgent((input) => [
      messagesSnapshot(input.messages.map(normalize)),
    ]);

  async function send(
    threadId: string,
    sent: Sent[],
    agent = new ScriptedAgent(),
  ) {
    const runner = new InMemoryAgentRunner();
    const input = {
      ...ownershipInput(threadId, "state"),
      messages: sent.map((m) => ({ role: "user", ...m })) as Message[],
    };
    agent.setMessages(input.messages);
    await collect(runner.run({ threadId, agent, input, ownerId: "" }));
    return runner
      .getThreadMessages(threadId, { ownerId: "" })
      .map((m) => `${m.id}:${String(m.content)}`);
  }

  const replay = async (threadId: string) =>
    JSON.stringify(
      await collect(
        new InMemoryAgentRunner().connect({ threadId, ownerId: "" }),
      ),
    );

  it("keeps stored messages when a run sends a list without them", async () => {
    const threadId = ownershipThreadId("history-partial");
    await send(threadId, [{ id: "a", content: "first" }]);
    expect(await send(threadId, [{ id: "b", content: "second" }])).toEqual([
      "a:first",
      "b:second",
    ]);
  });

  it("appends without duplicates when a client resends its whole list", async () => {
    const threadId = ownershipThreadId("history-full");
    await send(threadId, [{ id: "a", content: "first" }]);
    expect(
      await send(threadId, [
        { id: "a", content: "first" },
        { id: "b", content: "second" },
      ]),
    ).toEqual(["a:first", "b:second"]);
  });

  it("keeps a same-id edit out of the history, like connect replay", async () => {
    const threadId = ownershipThreadId("history-edit");
    await send(threadId, [{ id: "a", content: "first" }]);
    expect(await send(threadId, [{ id: "a", content: "edited" }])).toEqual([
      "a:first",
    ]);
    expect(await replay(threadId)).not.toContain("edited");
  });

  it("keeps a regenerated reply beside the new one, like connect replay", async () => {
    const threadId = ownershipThreadId("history-regenerate");
    const reply = (id: string, delta: string) =>
      new ScriptedAgent(
        () =>
          [
            {
              type: EventType.TEXT_MESSAGE_START,
              messageId: id,
              role: "assistant",
            },
            { type: EventType.TEXT_MESSAGE_CONTENT, messageId: id, delta },
            { type: EventType.TEXT_MESSAGE_END, messageId: id },
          ] as BaseEvent[],
      );
    const question = [{ id: "q", content: "question" }];
    await send(threadId, question, reply("r1", "one"));
    expect(await send(threadId, question, reply("r2", "two"))).toEqual([
      "q:question",
      "r1:one",
      "r2:two",
    ]);
    const replayed = await replay(threadId);
    expect(replayed).toContain("one");
    expect(replayed).toContain("two");
  });

  it.each([
    [
      "a later copy matches",
      [
        { id: "a", content: "CHANGED" },
        { id: "a", content: "first" },
      ],
    ],
    [
      "an earlier copy matches",
      [
        { id: "a", content: "first" },
        { id: "a", content: "CHANGED" },
      ],
    ],
    [
      "a copy changes the role",
      [
        { id: "a", role: "system", content: "" },
        { id: "a", content: "first" },
      ],
    ],
  ])("keeps the stored message when an id repeats and %s", async (_, sent) => {
    const threadId = ownershipThreadId("history-repeat");
    await send(threadId, [{ id: "a", content: "first" }]);
    await send(threadId, sent);
    const runner = new InMemoryAgentRunner();
    expect(runner.getThreadMessages(threadId, { ownerId: "" })).toEqual([
      { id: "a", role: "user", content: "first" },
    ]);
  });

  it.each([
    ["adds a field", (m: Message) => ({ ...m, name: "normalized" })],
    [
      "flattens content",
      (m: Message) => ({
        ...m,
        content: (m.content as { text: string }[])[0]?.text ?? m.content,
      }),
    ],
  ])(
    "refuses a differing copy that an agent which %s echoes in a snapshot",
    async (_, normalize) => {
      const threadId = ownershipThreadId("history-normalize");
      await send(threadId, [{ id: "a", content: "first" }]);
      expect(
        await send(
          threadId,
          [{ id: "a", content: [{ type: "text", text: "CHANGED" }] }],
          normalizingAgent(normalize),
        ),
      ).toEqual(["a:first"]);
    },
  );

  it("takes a change the agent makes through a snapshot", async () => {
    const threadId = ownershipThreadId("history-agent");
    await send(threadId, [{ id: "a", content: "first" }]);
    expect(
      await send(
        threadId,
        [{ id: "a", content: "first" }],
        normalizingAgent((m) => ({ ...m, content: "rewritten by agent" })),
      ),
    ).toEqual(["a:rewritten by agent"]);
  });

  it("takes a differing copy when the agent emitted events for that id", async () => {
    const threadId = ownershipThreadId("history-emitted");
    await send(threadId, [{ id: "a", content: "first" }]);
    const agent = new ScriptedAgent(
      () =>
        [
          {
            type: EventType.TEXT_MESSAGE_START,
            messageId: "a",
            role: "assistant",
          },
          {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: "a",
            delta: "streamed",
          },
          { type: EventType.TEXT_MESSAGE_END, messageId: "a" },
        ] as BaseEvent[],
    );
    const [stored] = await send(
      threadId,
      [{ id: "a", content: "other" }],
      agent,
    );
    expect(stored).toContain("streamed");
  });

  it("follows an agent that compacts the history through a snapshot", async () => {
    const threadId = ownershipThreadId("history-compact");
    const all = [
      { id: "a", content: "first" },
      { id: "b", content: "second" },
      { id: "c", content: "third" },
    ];
    await send(threadId, all);
    const compact = new ScriptedAgent(() => [
      messagesSnapshot(
        [{ id: "s", role: "system", content: "summary" }, all[2]!].map((m) => ({
          role: "user",
          ...m,
        })),
      ),
    ]);
    expect(await send(threadId, all, compact)).toEqual([
      "c:third",
      "s:summary",
    ]);
  });

  it("keeps a stored message an agent dropped after the client sent another copy", async () => {
    const threadId = ownershipThreadId("history-drop");
    await send(threadId, [{ id: "a", content: "first" }]);
    const dropping = new ScriptedAgent(() => [messagesSnapshot([])]);
    await send(threadId, [{ id: "a", role: "system", content: "" }], dropping);
    expect(
      new InMemoryAgentRunner().getThreadMessages(threadId, { ownerId: "" }),
    ).toEqual([{ id: "a", role: "user", content: "first" }]);
  });

  it("keeps a message the client left out when the agent compacts the rest", async () => {
    const threadId = ownershipThreadId("history-omitted");
    await send(threadId, [
      { id: "a", content: "first" },
      { id: "b", content: "second" },
    ]);
    const compact = new ScriptedAgent(() => [
      messagesSnapshot([{ id: "s", role: "system", content: "summary" }]),
    ]);
    expect(
      await send(threadId, [{ id: "b", content: "second" }], compact),
    ).toEqual(["a:first", "s:summary"]);
  });

  describe("under maxRunsPerThread", () => {
    afterEach(() => {
      ɵGLOBAL_STORE.setLimits(ɵINMEMORY_DEFAULTS);
    });

    it("drops messages no run touched within the cap", async () => {
      ɵGLOBAL_STORE.setLimits({ ...ɵINMEMORY_DEFAULTS, maxRunsPerThread: 3 });
      const threadId = ownershipThreadId("history-cap");
      let stored: string[] = [];
      for (let i = 0; i < 10; i++) {
        stored = await send(threadId, [{ id: `m${i}`, content: "x" }]);
      }
      expect(stored).toEqual(["m7:x", "m8:x", "m9:x"]);
    });

    it("keeps the whole history of a client that resends it", async () => {
      ɵGLOBAL_STORE.setLimits({ ...ɵINMEMORY_DEFAULTS, maxRunsPerThread: 3 });
      const threadId = ownershipThreadId("history-cap-full");
      const all: Sent[] = [];
      let stored: string[] = [];
      for (let i = 0; i < 10; i++) {
        all.push({ id: `m${i}`, content: "x" });
        stored = await send(threadId, all);
      }
      expect(stored).toHaveLength(10);
    });

    it("keeps growth inside the thread's own cap when bytes are tight", async () => {
      ɵGLOBAL_STORE.setLimits({
        ...ɵINMEMORY_DEFAULTS,
        maxRunsPerThread: 2,
        maxBytes: 12_000,
      });
      const quiet = ownershipThreadId("history-quiet");
      await send(quiet, [{ id: "q", content: "keep" }]);
      const busy = ownershipThreadId("history-busy");
      for (let i = 0; i < 40; i++) {
        await send(busy, [{ id: `m${i}`, content: "x".repeat(1000) }]);
      }
      expect(
        new InMemoryAgentRunner().getThreadMessages(quiet, { ownerId: "" }),
      ).toHaveLength(1);
    });
  });
});

describe("a clear while a run is active (T1)", () => {
  it("a scoped clear keeps a running thread, so nobody else can claim its id", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = ownershipThreadId("t1-scoped");
    const live = await startHanging(runner, threadId, "alice", "ALICE_LIVE");

    runner.clearThreads(ALICE);

    expect(ɵGLOBAL_STORE.peek(threadId)?.isRunning).toBe(true);
    expect(() =>
      runner.run({
        threadId,
        agent: new OwnershipTestAgent(),
        input: ownershipInput(threadId, "BOB"),
        ownerId: "bob",
      }),
    ).toThrow(ThreadAccessDeniedError);

    live.agent.release();
    await live.done;
    // The run's history landed in alice's thread.
    expect(JSON.stringify(runner.getThreadEvents(threadId, ALICE))).toContain(
      "ALICE_LIVE",
    );
  });

  it("an orphaned run never writes into a thread that another owner claimed after a reset", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = ownershipThreadId("t1-orphan");
    const live = await startHanging(runner, threadId, "alice", "ALICE_SECRET");

    // A full reset removes the running thread; bob then claims the id.
    ɵGLOBAL_STORE.clear();
    await runToEnd(runner, threadId, "bob", "BOB_SECRET");

    live.agent.release();
    await live.done;

    const events = JSON.stringify(runner.getThreadEvents(threadId, BOB));
    const messages = JSON.stringify(runner.getThreadMessages(threadId, BOB));
    expect(events).toContain("BOB_SECRET");
    expect(events).not.toContain("ALICE_SECRET");
    expect(messages).not.toContain("ALICE_SECRET");
  });
});

describe("an omitted owner or scope (T5)", () => {
  it("clearThreads() with no scope removes no identified or anonymous thread", async () => {
    const runner = new InMemoryAgentRunner();
    const aliceThread = ownershipThreadId("t5-alice");
    const anonThread = ownershipThreadId("t5-anon");
    await runToEnd(runner, aliceThread, "alice", "ALICE");
    await runToEnd(runner, anonThread, "", "ANON");

    runner.clearThreads();

    expect(runner.listThreads(ALICE).map((t) => t.id)).toContain(aliceThread);
    expect(runner.listThreads({ ownerId: "" }).map((t) => t.id)).toContain(
      anonThread,
    );
  });

  it("listThreads() and reads with no scope see no identified or anonymous thread", async () => {
    const runner = new InMemoryAgentRunner();
    const aliceThread = ownershipThreadId("t5-list-alice");
    const anonThread = ownershipThreadId("t5-list-anon");
    await runToEnd(runner, aliceThread, "alice", "ALICE_LISTED");
    await runToEnd(runner, anonThread, "", "ANON_LISTED");

    const ids = runner.listThreads().map((t) => t.id);
    expect(ids).not.toContain(aliceThread);
    expect(ids).not.toContain(anonThread);
    expect(JSON.stringify(runner.getThreadEvents(aliceThread))).not.toContain(
      "ALICE_LISTED",
    );
    expect(JSON.stringify(runner.getThreadEvents(anonThread))).not.toContain(
      "ANON_LISTED",
    );
  });

  it("a run without an owner does not create a thread that anonymous callers can reach", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = ownershipThreadId("t5-server");
    const agent = new OwnershipTestAgent();
    const input = ownershipInput(threadId, "SERVER_SECRET");
    agent.setMessages(input.messages);
    await collect(runner.run({ threadId, agent, input }));

    const anon = { ownerId: "" };
    expect(runner.listThreads(anon).map((t) => t.id)).not.toContain(threadId);
    expect(JSON.stringify(runner.getThreadEvents(threadId, anon))).toBe("[]");
    const replay = await collect(runner.connect({ threadId, ownerId: "" }));
    expect(JSON.stringify(replay)).not.toContain("SERVER_SECRET");
    expect(runner.isThreadAccessible(threadId, anon)).toBe(false);
    expect(() =>
      runner.run({
        threadId,
        agent: new OwnershipTestAgent(),
        input: ownershipInput(threadId, "ANON"),
        ownerId: "",
      }),
    ).toThrow(ThreadAccessDeniedError);

    // The server-side caller still reaches its own thread.
    expect(JSON.stringify(runner.getThreadEvents(threadId))).toContain(
      "SERVER_SECRET",
    );
    const own = await collect(runner.connect({ threadId }));
    expect(JSON.stringify(own)).toContain("SERVER_SECRET");
  });
});

describe("owner records after a thread is evicted (T6)", () => {
  afterEach(() => {
    // Restore the process-wide limits and owner retention for later tests.
    ɵGLOBAL_STORE.setLimits(ɵINMEMORY_DEFAULTS);
    ɵGLOBAL_STORE.ɵsetOwnerRetention({});
  });

  it("another identity cannot claim the id of an evicted thread", async () => {
    const runner = new InMemoryAgentRunner({ maxThreads: 1 });
    const threadId = ownershipThreadId("t6-evicted");
    await runToEnd(runner, threadId, "alice", "ALICE");
    // A second thread pushes alice's thread out of the one-thread store.
    await runToEnd(runner, ownershipThreadId("t6-other"), "carol", "CAROL");
    expect(ɵGLOBAL_STORE.peek(threadId)).toBeUndefined();

    expect(runner.isThreadAccessible(threadId, BOB)).toBe(false);
    expect(() =>
      runner.run({
        threadId,
        agent: new OwnershipTestAgent(),
        input: ownershipInput(threadId, "BOB"),
        ownerId: "bob",
      }),
    ).toThrow(ThreadAccessDeniedError);

    // The owner keeps the id.
    expect(runner.isThreadAccessible(threadId, ALICE)).toBe(true);
    await runToEnd(runner, threadId, "alice", "ALICE_AGAIN");
    expect(JSON.stringify(runner.getThreadEvents(threadId, ALICE))).toContain(
      "ALICE_AGAIN",
    );
  });

  it("forgets the owner of an evicted thread once its retention ends", async () => {
    let now = 1_000_000;
    ɵGLOBAL_STORE.ɵsetOwnerRetention({ ttlMs: 60_000, now: () => now });
    const runner = new InMemoryAgentRunner({ maxThreads: 1 });
    const threadId = ownershipThreadId("t6-expired");
    await runToEnd(runner, threadId, "alice", "ALICE");
    await runToEnd(runner, ownershipThreadId("t6-other"), "carol", "CAROL");

    now += 59_999;
    expect(runner.isThreadAccessible(threadId, BOB)).toBe(false);
    now += 2;
    expect(runner.isThreadAccessible(threadId, BOB)).toBe(true);
  });

  it("keeps a bounded number of owner records", async () => {
    ɵGLOBAL_STORE.ɵsetOwnerRetention({ maxEntries: 2 });
    const runner = new InMemoryAgentRunner({ maxThreads: 1 });
    const ids = [1, 2, 3, 4].map((n) => ownershipThreadId(`t6-bound-${n}`));
    for (const id of ids) await runToEnd(runner, id, "alice", "A");

    // ids[3] is live; ids[1] and ids[2] keep owner records; ids[0] fell out.
    expect(runner.isThreadAccessible(ids[0]!, BOB)).toBe(true);
    expect(runner.isThreadAccessible(ids[1]!, BOB)).toBe(false);
    expect(runner.isThreadAccessible(ids[2]!, BOB)).toBe(false);
    expect(runner.isThreadAccessible(ids[3]!, BOB)).toBe(false);
  });

  it("a flood of one identity's removed threads cannot push out another identity's record", async () => {
    ɵGLOBAL_STORE.ɵsetOwnerRetention({ maxEntries: 4, maxEntriesPerOwner: 2 });
    const runner = new InMemoryAgentRunner({ maxThreads: 1 });
    const victim = ownershipThreadId("t6-flood-victim");
    await runToEnd(runner, victim, "alice", "ALICE");
    for (let n = 0; n < 8; n++) {
      await runToEnd(runner, ownershipThreadId(`t6-flood-${n}`), "bob", "B");
    }

    // Bob's flood evicted only bob's own older records.
    expect(runner.isThreadAccessible(victim, BOB)).toBe(false);
    expect(runner.isThreadAccessible(victim, ALICE)).toBe(true);
  });

  it("drops expired records before any live one", async () => {
    let now = 1_000_000;
    ɵGLOBAL_STORE.ɵsetOwnerRetention({
      ttlMs: 60_000,
      maxEntries: 2,
      now: () => now,
    });
    const runner = new InMemoryAgentRunner({ maxThreads: 1 });
    const expired = ownershipThreadId("t6-expired-first");
    const live = ownershipThreadId("t6-live-kept");
    await runToEnd(runner, expired, "carol", "C");
    now += 60_001;
    await runToEnd(runner, live, "alice", "A");
    await runToEnd(runner, ownershipThreadId("t6-push-1"), "dave", "D");
    await runToEnd(runner, ownershipThreadId("t6-push-2"), "erin", "E");

    expect(runner.isThreadAccessible(expired, BOB)).toBe(true);
    expect(runner.isThreadAccessible(live, BOB)).toBe(false);
  });
});

describe("isRunning (T11)", () => {
  it("reports another identity's live run as not running", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = ownershipThreadId("t11-running");
    const live = await startHanging(runner, threadId, "alice", "ALICE_LIVE");

    expect(await runner.isRunning({ threadId, ownerId: "alice" })).toBe(true);
    expect(await runner.isRunning({ threadId, ownerId: "bob" })).toBe(false);
    expect(await runner.isRunning({ threadId, ownerId: "" })).toBe(false);
    expect(await runner.isRunning({ threadId })).toBe(false);

    live.agent.release();
    await live.done;
  });
});

describe("runner-level owner check", () => {
  it("refuses a run on a thread that another identity owns, before touching it", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = ownershipThreadId("runner-denial");
    await runToEnd(runner, threadId, "alice", "ALICE_SECRET");
    const before = JSON.stringify(runner.getThreadEvents(threadId, ALICE));

    for (const ownerId of ["bob", "", undefined]) {
      expect(() =>
        runner.run({
          threadId,
          agent: new OwnershipTestAgent(),
          input: ownershipInput(threadId, "INJECTED"),
          ...(ownerId === undefined ? {} : { ownerId }),
        }),
      ).toThrow(ThreadAccessDeniedError);
    }
    expect(JSON.stringify(runner.getThreadEvents(threadId, ALICE))).toBe(
      before,
    );
    expect(ɵGLOBAL_STORE.peek(threadId)?.isRunning).toBe(false);
  });
});

describe("a run whose teardown fails", () => {
  it("does not leave its thread running", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = ownershipThreadId("teardown-failure");
    const agent = new OwnershipTestAgent();
    // Reading the agent's messages at the end of the run throws.
    Object.defineProperty(agent, "messages", {
      get() {
        throw new Error("MESSAGES_UNREADABLE");
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let ended = false;
      runner
        .run({
          threadId,
          agent,
          input: ownershipInput(threadId, "ALICE"),
          ownerId: "alice",
        })
        .subscribe({
          error: () => {
            ended = true;
          },
          complete: () => {
            ended = true;
          },
        });
      await vi.waitFor(() => expect(ended).toBe(true), { timeout: 1000 });

      expect(await runner.isRunning({ threadId, ownerId: "alice" })).toBe(
        false,
      );
      expect(error).toHaveBeenCalled();
      const next = await runToEnd(runner, threadId, "alice", "ALICE_AGAIN");
      expect(JSON.stringify(next)).toContain("RUN_FINISHED");
    } finally {
      error.mockRestore();
    }
  });
});
