/**
 * Thread ownership in SqliteAgentRunner: on the runner itself, and through
 * the real runtime handler with an identity callback.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  RunAgentInput,
  RunAgentResult,
  RunStartedEvent,
} from "@ag-ui/client";
import type { Observable } from "rxjs";
import { EMPTY } from "rxjs";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import {
  CopilotRuntime,
  ThreadAccessDeniedError,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { SqliteAgentRunner } from "..";

type Callbacks = {
  onEvent: (event: { event: BaseEvent }) => void;
  onRunStartedEvent?: () => void;
};

/** Emits the caller's secret in a STATE_SNAPSHOT; with `hang`, waits for abort. */
class SecretAgent extends AbstractAgent {
  private release: (() => void) | null = null;
  private markStarted!: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  constructor(private readonly hang = false) {
    super();
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }

  clone(): SecretAgent {
    return new SecretAgent(this.hang);
  }

  abortRun(): void {
    this.release?.();
  }

  async runAgent(
    input: RunAgentInput,
    callbacks: Callbacks,
  ): Promise<RunAgentResult> {
    const started: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    callbacks.onEvent({ event: started });
    callbacks.onRunStartedEvent?.();
    callbacks.onEvent({
      event: {
        type: EventType.STATE_SNAPSHOT,
        snapshot: { secret: (input.state as { secret?: string }).secret },
      } as BaseEvent,
    });
    this.markStarted();
    if (this.hang) {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    }
    callbacks.onEvent({
      event: {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
    });
    return { result: undefined, newMessages: [] };
  }
}

let seq = 0;
function threadIdFor(label: string): string {
  seq += 1;
  return `${label}-${Date.now().toString(36)}-${seq}`;
}

function inputFor(threadId: string, secret: string, runId?: string) {
  return {
    threadId,
    runId: runId ?? `run-${threadId}-${Math.random().toString(36).slice(2)}`,
    messages: [
      {
        id: `msg-${threadId}-${secret}`,
        role: "user" as const,
        content: secret,
      },
    ],
    state: { secret },
    tools: [],
    context: [],
    forwardedProps: {},
  };
}

function collect(stream: Observable<BaseEvent>): Promise<BaseEvent[]> {
  return new Promise((resolve, reject) => {
    const events: BaseEvent[] = [];
    stream.subscribe({
      next: (event) => events.push(event),
      error: reject,
      complete: () => resolve(events),
    });
  });
}

const runners: SqliteAgentRunner[] = [];
const hanging: SecretAgent[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const agent of hanging.splice(0)) agent.abortRun();
  // Let aborted runs finish writing before their database closes.
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const runner of runners.splice(0)) runner.close();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A database file path in a temp directory that is removed after the test. */
function tempDbPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-owner-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

function newRunner(dbPath?: string): SqliteAgentRunner {
  const runner = new SqliteAgentRunner(dbPath ? { dbPath } : {});
  runners.push(runner);
  return runner;
}

describe("SqliteAgentRunner thread ownership", () => {
  it("keeps each identity to its own threads", async () => {
    const runner = newRunner();
    const threadId = threadIdFor("sqlite-owned");
    await collect(
      runner.run({
        threadId,
        agent: new SecretAgent(),
        input: inputFor(threadId, "ALICE_SECRET"),
        ownerId: "alice",
      }),
    );

    expect(runner.isThreadAccessible(threadId, { ownerId: "alice" })).toBe(
      true,
    );
    expect(runner.isThreadAccessible(threadId, { ownerId: "bob" })).toBe(false);
    expect(runner.isThreadAccessible(threadId, { ownerId: "" })).toBe(false);

    const foreign = await collect(runner.connect({ threadId, ownerId: "bob" }));
    expect(JSON.stringify(foreign)).not.toContain("ALICE_SECRET");
    const own = await collect(runner.connect({ threadId, ownerId: "alice" }));
    expect(JSON.stringify(own)).toContain("ALICE_SECRET");

    expect(() =>
      runner.run({
        threadId,
        agent: new SecretAgent(),
        input: inputFor(threadId, "BOB_INJECTED"),
        ownerId: "bob",
      }),
    ).toThrow(ThreadAccessDeniedError);
    const after = await collect(runner.connect({ threadId, ownerId: "alice" }));
    expect(JSON.stringify(after)).not.toContain("BOB_INJECTED");
  });

  it("does not let another identity stop or observe a live run", async () => {
    const runner = newRunner();
    const threadId = threadIdFor("sqlite-live");
    const agent = new SecretAgent(true);
    hanging.push(agent);
    const input = inputFor(threadId, "ALICE_LIVE", `run-${threadId}`);
    const done = collect(
      runner.run({ threadId, agent, input, ownerId: "alice" }),
    );
    await agent.started;

    expect(await runner.isRunning({ threadId, ownerId: "bob" })).toBe(false);
    expect(await runner.isRunning({ threadId, ownerId: "alice" })).toBe(true);
    expect(await runner.stop({ threadId, ownerId: "bob" })).toBe(false);
    expect(
      await runner.stop({ threadId, runId: input.runId, ownerId: "bob" }),
    ).toBe(false);
    expect(
      await runner.stop({
        threadId,
        runId: "some-other-run",
        ownerId: "alice",
      }),
    ).toBe(false);
    expect(
      await runner.stop({ threadId, runId: input.runId, ownerId: "alice" }),
    ).toBe(true);
    await done;
  });
});

/**
 * Writes a database in the schema from before owners were stored, with one
 * finished run on `threadId` whose state holds `secret`.
 */
function writeLegacyDb(dbPath: string, threadId: string, secret: string) {
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE, parent_run_id TEXT, events TEXT NOT NULL,
      input TEXT NOT NULL, created_at INTEGER NOT NULL, version INTEGER NOT NULL);
    CREATE TABLE run_state (thread_id TEXT PRIMARY KEY, is_running INTEGER DEFAULT 0,
      current_run_id TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_version VALUES (1, 0);
  `);
  legacy
    .prepare(
      "INSERT INTO agent_runs (thread_id, run_id, parent_run_id, events, input, created_at, version) VALUES (?, ?, NULL, ?, ?, ?, 1)",
    )
    .run(
      threadId,
      `legacy-run-${threadId}`,
      JSON.stringify([
        { type: EventType.RUN_STARTED, threadId, runId: "legacy-run" },
        { type: EventType.STATE_SNAPSHOT, snapshot: { secret } },
        { type: EventType.RUN_FINISHED, threadId, runId: "legacy-run" },
      ]),
      JSON.stringify(inputFor(threadId, secret, "legacy-run")),
      Date.now(),
    );
  legacy.close();
}

describe("SqliteAgentRunner threads stored before owners were recorded", () => {
  it("stay reachable by id for every caller, as before the upgrade", async () => {
    const dbPath = tempDbPath("legacy.db");
    const threadId = threadIdFor("sqlite-legacy");
    writeLegacyDb(dbPath, threadId, "LEGACY_SECRET");
    const runner = newRunner(dbPath);

    for (const ownerId of ["alice", "bob", ""]) {
      expect(runner.isThreadAccessible(threadId, { ownerId })).toBe(true);
      const replay = await collect(runner.connect({ threadId, ownerId }));
      expect(JSON.stringify(replay)).toContain("LEGACY_SECRET");
    }
    // A server-side caller that names no owner keeps them too.
    expect(
      JSON.stringify(await collect(runner.connect({ threadId }))),
    ).toContain("LEGACY_SECRET");
  });

  it("stay unowned when an identity continues them", async () => {
    const dbPath = tempDbPath("legacy.db");
    const threadId = threadIdFor("sqlite-legacy-run");
    writeLegacyDb(dbPath, threadId, "LEGACY_SECRET");
    const runner = newRunner(dbPath);

    await collect(
      runner.run({
        threadId,
        agent: new SecretAgent(),
        input: inputFor(threadId, "ALICE_TURN"),
        ownerId: "alice",
      }),
    );
    // Continuing does not claim the thread for alice: bob, who also holds
    // the id, still reaches and continues it.
    expect(runner.isThreadAccessible(threadId, { ownerId: "bob" })).toBe(true);
    await collect(
      runner.run({
        threadId,
        agent: new SecretAgent(),
        input: inputFor(threadId, "BOB_TURN"),
        ownerId: "bob",
      }),
    );
    const replay = JSON.stringify(
      await collect(runner.connect({ threadId, ownerId: "alice" })),
    );
    expect(replay).toContain("BOB_TURN");
  });

  it("never make a new thread unowned", async () => {
    const dbPath = tempDbPath("legacy.db");
    writeLegacyDb(dbPath, threadIdFor("sqlite-legacy-other"), "LEGACY_SECRET");
    const runner = newRunner(dbPath);
    const threadId = threadIdFor("sqlite-new-after-upgrade");

    await collect(
      runner.run({
        threadId,
        agent: new SecretAgent(),
        input: inputFor(threadId, "ALICE_NEW"),
        ownerId: "alice",
      }),
    );
    expect(runner.isThreadAccessible(threadId, { ownerId: "bob" })).toBe(false);
    expect(runner.isThreadAccessible(threadId, { ownerId: "" })).toBe(false);
    expect(
      JSON.stringify(
        await collect(runner.connect({ threadId, ownerId: "bob" })),
      ),
    ).not.toContain("ALICE_NEW");
    expect(() =>
      runner.run({
        threadId,
        agent: new SecretAgent(),
        input: inputFor(threadId, "BOB_INJECTED"),
        ownerId: "bob",
      }),
    ).toThrow(ThreadAccessDeniedError);
  });

  it("are logged once when the runner opens the database", () => {
    const dbPath = tempDbPath("legacy.db");
    writeLegacyDb(dbPath, threadIdFor("sqlite-legacy-log-a"), "A");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    newRunner(dbPath);
    const legacyWarnings = warn.mock.calls
      .map((call: unknown[]) => call.map(String).join(" "))
      .filter((line) => line.includes("before thread owners were recorded"));
    expect(legacyWarnings).toHaveLength(1);
    expect(legacyWarnings[0]).toContain("1 thread");

    // A database with no such threads logs nothing.
    warn.mockClear();
    newRunner();
    expect(warn).not.toHaveBeenCalled();
  });
});

/** A hanging agent whose first abort fails, as an agent mid-teardown may. */
class FlakyAbortAgent extends SecretAgent {
  aborts = 0;

  constructor() {
    super(true);
  }

  override abortRun(): void {
    this.aborts += 1;
    if (this.aborts === 1) throw new Error("abort failed");
    super.abortRun();
  }
}

describe("SqliteAgentRunner stop after a failed abort", () => {
  it("still stops the run by its run id", async () => {
    const runner = newRunner();
    const threadId = threadIdFor("sqlite-flaky-abort");
    const agent = new FlakyAbortAgent();
    hanging.push(agent);
    const input = inputFor(threadId, "ALICE", `run-${threadId}`);
    const done = collect(
      runner.run({ threadId, agent, input, ownerId: "alice" }),
    );
    await agent.started;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const stop = { threadId, runId: input.runId, ownerId: "alice" };
    expect(await runner.stop(stop)).toBe(false);
    expect(await runner.isRunning({ threadId, ownerId: "alice" })).toBe(true);
    expect(await runner.stop(stop)).toBe(true);
    await done;
    expect(await runner.isRunning({ threadId, ownerId: "alice" })).toBe(false);
  });
});

/** Emits an event that cannot be stored (JSON has no BigInt), then finishes. */
class UnstorableEventAgent extends SecretAgent {
  override async runAgent(
    input: RunAgentInput,
    callbacks: Callbacks,
  ): Promise<RunAgentResult> {
    callbacks.onEvent({
      event: {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent,
    });
    callbacks.onEvent({
      event: {
        type: EventType.CUSTOM,
        name: "unstorable",
        value: BigInt(1),
      } as BaseEvent,
    });
    return { result: undefined, newMessages: [] };
  }
}

/** Fails the way a crashing agent does. */
class ThrowingAgent extends SecretAgent {
  override async runAgent(): Promise<RunAgentResult> {
    throw new Error("AGENT_EXPLODED");
  }
}

describe("SqliteAgentRunner run teardown failures", () => {
  it("does not leave a thread running when its run cannot be stored", async () => {
    const runner = newRunner();
    const threadId = threadIdFor("sqlite-unstorable");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: BaseEvent[] = [];
    let completed = false;
    runner
      .run({
        threadId,
        agent: new UnstorableEventAgent(),
        input: inputFor(threadId, "ALICE"),
        ownerId: "alice",
      })
      .subscribe({
        next: (event) => events.push(event),
        error: () => {
          completed = true;
        },
        complete: () => {
          completed = true;
        },
      });

    await vi.waitFor(() => expect(completed).toBe(true), { timeout: 1000 });
    expect(await runner.isRunning({ threadId, ownerId: "alice" })).toBe(false);
    expect(error).toHaveBeenCalled();
    // The thread takes a new run.
    const next = await collect(
      runner.run({
        threadId,
        agent: new SecretAgent(),
        input: inputFor(threadId, "ALICE_AGAIN"),
        ownerId: "alice",
      }),
    );
    expect(JSON.stringify(next)).toContain("RUN_FINISHED");
  });

  it("logs the agent error of a failed run", async () => {
    const runner = newRunner();
    const threadId = threadIdFor("sqlite-agent-error");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await collect(
      runner.run({
        threadId,
        agent: new ThrowingAgent(),
        input: inputFor(threadId, "ALICE"),
        ownerId: "alice",
      }),
    );
    const logged = error.mock.calls
      .flat()
      .map((arg: unknown) =>
        arg instanceof Error ? arg.message : JSON.stringify(arg),
      );
    expect(logged.join(" ")).toContain("AGENT_EXPLODED");
    expect(logged.join(" ")).toContain(threadId);
  });
});

describe("SqliteAgentRunner runners that share one database file", () => {
  it("refuses a run whose owner claim lost to another runner", async () => {
    const dbPath = tempDbPath("shared.db");
    const winner = newRunner(dbPath);
    const loser = newRunner(dbPath);
    const threadId = threadIdFor("sqlite-claim-race");

    // The winner (another process on the same file) claims the thread after
    // the loser checked access and before the loser records its own claim.
    const loserState = loser as unknown as {
      getRunState(threadId: string): unknown;
    };
    const readState = loserState.getRunState.bind(loser);
    let winnerRun: Promise<BaseEvent[]> | undefined;
    vi.spyOn(loserState, "getRunState").mockImplementationOnce((id) => {
      const state = readState(id);
      winnerRun = collect(
        winner.run({
          threadId,
          agent: new SecretAgent(),
          input: inputFor(threadId, "ALICE_SECRET"),
          ownerId: "alice",
        }),
      );
      return state;
    });

    expect(() =>
      loser.run({
        threadId,
        agent: new SecretAgent(),
        input: inputFor(threadId, "BOB_INJECTED"),
        ownerId: "bob",
      }),
    ).toThrow(ThreadAccessDeniedError);
    expect(winnerRun).toBeDefined();
    await winnerRun;

    const replay = JSON.stringify(
      await collect(winner.connect({ threadId, ownerId: "alice" })),
    );
    expect(replay).toContain("ALICE_SECRET");
    expect(replay).not.toContain("BOB_INJECTED");
    expect(loser.isThreadAccessible(threadId, { ownerId: "bob" })).toBe(false);
  });
});

describe("SqliteAgentRunner instances in one process", () => {
  it("keep their live runs apart for the same thread id", async () => {
    const runnerA = newRunner();
    const runnerB = newRunner();
    const threadId = threadIdFor("sqlite-instances");

    const aliceAgent = new SecretAgent(true);
    hanging.push(aliceAgent);
    const aliceInput = inputFor(threadId, "ALICE_LIVE", `run-a-${threadId}`);
    const aliceDone = collect(
      runnerA.run({
        threadId,
        agent: aliceAgent,
        input: aliceInput,
        ownerId: "alice",
      }),
    );
    await aliceAgent.started;

    // Runner B has its own database, where bob may claim the same id.
    const bobAgent = new SecretAgent(true);
    hanging.push(bobAgent);
    const bobDone = collect(
      runnerB.run({
        threadId,
        agent: bobAgent,
        input: inputFor(threadId, "BOB_LIVE", `run-b-${threadId}`),
        ownerId: "bob",
      }),
    );
    await bobAgent.started;

    // Bob's live view on runner B carries none of alice's events.
    const bobEvents: BaseEvent[] = [];
    const bobView = runnerB
      .connect({ threadId, ownerId: "bob" })
      .subscribe((event) => bobEvents.push(event));
    expect(JSON.stringify(bobEvents)).toContain("BOB_LIVE");
    expect(JSON.stringify(bobEvents)).not.toContain("ALICE_LIVE");
    bobView.unsubscribe();

    // Alice's stop on runner A stops her run, never bob's on runner B.
    expect(
      await runnerA.stop({
        threadId,
        runId: aliceInput.runId,
        ownerId: "alice",
      }),
    ).toBe(true);
    await aliceDone;
    expect(await runnerB.isRunning({ threadId, ownerId: "bob" })).toBe(true);

    bobAgent.abortRun();
    const bobStream = JSON.stringify(await bobDone);
    expect(bobStream).not.toContain("ALICE_LIVE");
  });
});

describe("SqliteAgentRunner behind a runtime with identifyUser", () => {
  const BASE = "http://localhost/api/copilotkit";
  const identify = (request: Request) => {
    const id = request.headers.get("x-test-user");
    if (!id) throw new Error("not signed in");
    return { id, name: id };
  };

  function makeHandler(runner: SqliteAgentRunner) {
    const runtime = new CopilotRuntime({
      agents: { secret: new SecretAgent() },
      runner,
      identifyUser: identify,
    });
    return createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit",
    });
  }

  function post(
    handler: (request: Request) => Promise<Response>,
    route: string,
    user: string,
    body: string,
  ) {
    return handler(
      new Request(`${BASE}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": user },
        body,
      }),
    );
  }

  it("serves each user only their own thread", async () => {
    const handler = makeHandler(newRunner());
    const threadId = threadIdFor("sqlite-http");
    const body = (secret: string) => JSON.stringify(inputFor(threadId, secret));

    const aliceRun = await post(
      handler,
      "/agent/secret/run",
      "alice",
      body("ALICE_SECRET"),
    );
    expect(aliceRun.status).toBe(200);
    expect(await aliceRun.text()).toContain("RUN_FINISHED");

    const bobReplay = await post(
      handler,
      "/agent/secret/connect",
      "bob",
      body("x"),
    );
    expect(bobReplay.status).toBe(200);
    expect(await bobReplay.text()).not.toContain("ALICE_SECRET");

    const bobRun = await post(
      handler,
      "/agent/secret/run",
      "bob",
      body("BOB_INJECTED"),
    );
    expect(bobRun.status).toBe(404);
    await bobRun.text();

    const aliceReplay = await post(
      handler,
      "/agent/secret/connect",
      "alice",
      body("x"),
    );
    const aliceText = await aliceReplay.text();
    expect(aliceText).toContain("ALICE_SECRET");
    expect(aliceText).not.toContain("BOB_INJECTED");
  });

  it("serves a thread stored before owners were recorded to every user", async () => {
    const dbPath = tempDbPath("legacy-http.db");
    const threadId = threadIdFor("sqlite-http-legacy");
    writeLegacyDb(dbPath, threadId, "LEGACY_SECRET");
    const handler = makeHandler(newRunner(dbPath));
    const body = JSON.stringify(inputFor(threadId, "x"));
    for (const user of ["alice", "bob"]) {
      const replay = await post(handler, "/agent/secret/connect", user, body);
      expect(replay.status).toBe(200);
      expect(await replay.text()).toContain("LEGACY_SECRET");
    }
  });
});
