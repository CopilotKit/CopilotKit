/**
 * Thread access with runners other than the default InMemoryAgentRunner:
 * runners that do not record owners, and runners built against an older
 * version of the local Thread endpoint interface.
 */
import { describe, expect, it, vi } from "vitest";
import type { BaseEvent } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { throwError } from "rxjs";
import {
  AgentRunner,
  THREAD_ACCESS_DENIED_ERROR_CODE,
  ThreadAccessDeniedError,
} from "../runner/agent-runner";
import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentRunnerStopRequest,
  LocalThreadEndpointRecord,
} from "../runner/agent-runner";
import { InMemoryAgentRunner } from "../runner/in-memory";
import { TelemetryAgentRunner } from "../../../v1-deprecated/lib/runtime/telemetry-agent-runner";
import { CopilotRuntime as V1CopilotRuntime } from "../../../v1-deprecated/lib/runtime/copilot-runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type {
  RuntimeErrorReporter,
  RuntimeErrorReporterOptions,
} from "../core/runtime-error-reporter";
import { runtimeErrorReporterOption } from "../core/runtime-error-reporter";
import {
  get,
  identifyFromHeader,
  isolateThreadStore,
  makeHandler,
  post,
  runBody,
  runThread,
  testAgents,
  uniqueThreadId,
} from "./helpers/thread-access-harness";

isolateThreadStore();

/**
 * A runner that keeps history but ignores `ownerId`, like a custom runner
 * written before ownership existed: every caller shares every thread.
 */
class OwnerBlindRunner extends AgentRunner {
  protected readonly inner = new InMemoryAgentRunner();

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return this.inner.run({ ...request, ownerId: undefined });
  }
  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return this.inner.connect({ ...request, ownerId: undefined });
  }
  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return this.inner.isRunning(request);
  }
  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    return this.inner.stop({ ...request, ownerId: undefined });
  }
}

/**
 * A runner built against the earlier local Thread endpoint interface: it sets
 * the endpoint flag but has no `isThreadAccessible`.
 */
class StaleEndpointRunner extends OwnerBlindRunner {
  readonly ɵsupportsLocalThreadEndpoints = true;

  listThreads(): LocalThreadEndpointRecord[] {
    return this.inner.listThreads();
  }
  getThreadMessages(threadId: string) {
    return this.inner.getThreadMessages(threadId);
  }
  getThreadEvents(threadId: string) {
    return this.inner.getThreadEvents(threadId);
  }
  getThreadState(threadId: string) {
    return this.inner.getThreadState(threadId);
  }
  clearThreads(): void {
    this.inner.clearThreads();
  }
}

describe("a runner without isThreadAccessible (T7)", () => {
  it("still runs agents for callers without identity", async () => {
    const handler = makeHandler({ runner: new StaleEndpointRunner() });
    const run = await runThread(handler, {
      threadId: uniqueThreadId("t7"),
      secret: "T7_SECRET",
    });
    expect(run.status).toBe(200);
    expect(run.bodyText).toContain("RUN_FINISHED");
  });
});

describe("identifyUser with a runner that does not enforce owners (T2)", () => {
  async function expectOwnershipUnsupported(
    response: Response,
    runnerName = "OwnerBlindRunner",
  ) {
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("thread_ownership_unsupported");
    expect(body.message).toContain(runnerName);
    expect(body.message).toContain("isThreadAccessible");
  }

  it("refuses run, connect and stop with a configuration error", async () => {
    const handler = makeHandler({
      runner: new OwnerBlindRunner(),
      identifyUser: identifyFromHeader,
    });
    const threadId = uniqueThreadId("t2-blind");

    await expectOwnershipUnsupported(
      await post(
        handler,
        "/agent/secret/run",
        "alice",
        runBody(threadId, "ALICE_SECRET"),
      ),
    );
    await expectOwnershipUnsupported(
      await post(
        handler,
        "/agent/secret/connect",
        "bob",
        runBody(threadId, "x"),
      ),
    );
    await expectOwnershipUnsupported(
      await post(handler, `/agent/secret/stop/${threadId}`, "bob"),
    );
  });

  it("refuses the thread routes of a stale endpoint runner", async () => {
    const handler = makeHandler({
      runner: new StaleEndpointRunner(),
      identifyUser: identifyFromHeader,
    });
    const threadId = uniqueThreadId("t2-stale");
    const responses = [
      await get(handler, "/threads", "bob"),
      await get(handler, `/threads/${threadId}/messages`, "bob"),
      await get(handler, `/threads/${threadId}/events`, "bob"),
      await get(handler, `/threads/${threadId}/state`, "bob"),
      await post(handler, "/threads/clear", "bob"),
    ];
    for (const response of responses) {
      await expectOwnershipUnsupported(response, "StaleEndpointRunner");
    }
  });

  it("logs the misconfiguration once at construction", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      makeHandler({
        runner: new OwnerBlindRunner(),
        identifyUser: identifyFromHeader,
      });
    } finally {
      console.warn = original;
    }
    expect(warnings.filter((w) => w.includes("thread ownership")).length).toBe(
      1,
    );
  });
});

describe("a run refused by the runner itself (T4)", () => {
  /** A reporter that records every error the runtime reports as an agent failure. */
  function reporterOptions(): {
    reported: unknown[];
    options: RuntimeErrorReporterOptions;
  } {
    const reported: unknown[] = [];
    const reporter: RuntimeErrorReporter = {
      report: vi.fn((params) => {
        reported.push(params.error);
      }),
    };
    return {
      reported,
      options: { [runtimeErrorReporterOption]: reporter },
    };
  }

  it("TelemetryAgentRunner keeps the owner check before the run starts", async () => {
    const { reported, options } = reporterOptions();
    const handler = makeHandler({
      ...options,
      runner: new TelemetryAgentRunner({ runner: new InMemoryAgentRunner() }),
      identifyUser: identifyFromHeader,
    });
    const threadId = uniqueThreadId("t4-telemetry");
    const own = await runThread(handler, {
      user: "alice",
      threadId,
      secret: "ALICE_SECRET",
    });
    expect(own.status).toBe(200);
    expect(own.bodyText).toContain("RUN_FINISHED");

    const foreign = await runThread(handler, {
      user: "bob",
      threadId,
      secret: "BOB",
    });
    expect(foreign.status).toBe(404);
    expect(foreign.bodyText).not.toContain("ALICE_SECRET");
    expect(reported).toEqual([]);
  });

  it("maps a refusal that slipped past the pre-check to an HTTP error, not an agent failure", async () => {
    // The pre-check passes (as when another identity claims the thread between
    // the check and the run), so only the runner refuses.
    class RacingRunner extends InMemoryAgentRunner {
      override isThreadAccessible(): boolean {
        return true;
      }
    }
    const { reported, options } = reporterOptions();
    const handler = makeHandler({
      ...options,
      runner: new RacingRunner(),
      identifyUser: identifyFromHeader,
    });
    const threadId = uniqueThreadId("t4-race");
    await runThread(handler, { user: "alice", threadId, secret: "ALICE" });

    const raced = await runThread(handler, {
      user: "bob",
      threadId,
      secret: "BOB",
    });
    expect(raced.status).toBe(404);
    expect(raced.bodyText).not.toContain("Agent run failed");
    expect(reported).toEqual([]);
  });

  it("streams a refusal raised after the stream opened as a coded access error", async () => {
    class LateDenyRunner extends InMemoryAgentRunner {
      override run(): Observable<BaseEvent> {
        return throwError(() => new ThreadAccessDeniedError());
      }
    }
    const { reported, options } = reporterOptions();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const handler = makeHandler({ ...options, runner: new LateDenyRunner() });
      const run = await runThread(handler, {
        threadId: uniqueThreadId("t4-late"),
        secret: "X",
      });
      expect(run.status).toBe(200);
      expect(run.bodyText).toContain("RUN_ERROR");
      expect(run.bodyText).toContain(THREAD_ACCESS_DENIED_ERROR_CODE);
      expect(run.bodyText).toContain("Thread access denied");
      expect(run.bodyText).not.toContain("Agent run failed");
      expect(reported).toEqual([]);
      // Logged as an access denial, not as an agent crash.
      expect(error).not.toHaveBeenCalledWith(
        "Error running agent:",
        expect.anything(),
      );
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("gives ThreadAccessDeniedError a stable code", () => {
    expect(THREAD_ACCESS_DENIED_ERROR_CODE).toBe("THREAD_ACCESS_DENIED");
    expect(new ThreadAccessDeniedError().code).toBe(
      THREAD_ACCESS_DENIED_ERROR_CODE,
    );
  });
});

describe("the v1 CopilotRuntime without Intelligence", () => {
  function v1Handler(runner?: AgentRunner) {
    const runtime = new V1CopilotRuntime({
      agents: testAgents(),
      identifyUser: identifyFromHeader,
      ...(runner ? { runner } : {}),
    }).instance;
    return {
      runtime,
      handler: createCopilotRuntimeHandler({
        runtime,
        basePath: "/api/copilotkit",
      }),
    };
  }

  it("does not hand identifyUser to the SSE runtime, as before", () => {
    expect(v1Handler().runtime.identifyUser).toBeUndefined();
  });

  it("keeps serving runs through a runner that does not record owners", async () => {
    const { handler } = v1Handler(new OwnerBlindRunner());
    const run = await runThread(handler, {
      user: "alice",
      threadId: uniqueThreadId("v1-blind"),
      secret: "V1_SECRET",
    });
    expect(run.status).toBe(200);
    expect(run.bodyText).toContain("RUN_FINISHED");
  });

  it("keeps thread ids working as capabilities", async () => {
    const { handler } = v1Handler();
    const threadId = uniqueThreadId("v1-capability");
    const run = await runThread(handler, {
      user: "alice",
      threadId,
      secret: "V1_ALICE",
    });
    expect(run.status).toBe(200);
    const replay = await post(
      handler,
      "/agent/secret/connect",
      "bob",
      runBody(threadId, "x"),
    );
    expect(await replay.text()).toContain("V1_ALICE");
  });
});
