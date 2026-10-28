/**
 * Thread ownership inside InMemoryAgentRunner, tested on the runner itself.
 * The HTTP routes are covered by `__tests__/thread-access.test.ts`.
 */
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
