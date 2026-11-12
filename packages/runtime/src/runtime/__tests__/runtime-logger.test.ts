import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { EMPTY } from "rxjs";
import type { Observable } from "rxjs";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentResult } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import { CopilotRuntime } from "../core/runtime";
import type {
  CopilotRuntimeLogger,
  CopilotSseRuntimeOptions,
} from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";

type Level = "debug" | "info" | "warn" | "error";

interface LogCall {
  level: Level;
  bindings: Record<string, unknown>;
  args: unknown[];
}

/** A pino-shaped logger that records each call with the child bindings. */
function createRecordingLogger() {
  const calls: LogCall[] = [];
  const build = (bindings: Record<string, unknown>): CopilotRuntimeLogger => {
    const method =
      (level: Level) =>
      (...args: unknown[]) => {
        calls.push({ level, bindings, args });
      };
    return {
      debug: method("debug"),
      info: method("info"),
      warn: method("warn"),
      error: method("error"),
      child: (more) => build({ ...bindings, ...more }),
    };
  };
  return { logger: build({}), calls };
}

const AGENT_ERROR = new Error("agent exploded");

class FinishingAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }

  async runAgent(): Promise<RunAgentResult> {
    return { result: undefined, newMessages: [] };
  }

  clone(): AbstractAgent {
    return new FinishingAgent();
  }
}

/** Fails before the run starts, so the handler logs the error itself. */
class FailingAgent extends FinishingAgent {
  async getCapabilities(): Promise<AgentCapabilities> {
    throw new Error("capabilities unavailable");
  }

  clone(): AbstractAgent {
    throw AGENT_ERROR;
  }
}

function createHandler(
  options: Pick<CopilotSseRuntimeOptions, "logger" | "debug"> = {},
): (request: Request) => Promise<Response> {
  const runtime = new CopilotRuntime({
    agents: { finishing: new FinishingAgent(), failing: new FailingAgent() },
    ...options,
  });
  return createCopilotRuntimeHandler({ runtime, basePath: "/api" });
}

async function runAgent(
  handler: (request: Request) => Promise<Response>,
  agentId: "finishing" | "failing",
) {
  const response = await handler(
    new Request(`http://localhost/api/agent/${agentId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: `thread-${agentId}`,
        runId: "run-1",
        state: {},
        messages: [],
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    }),
  );
  await response.text();
}

describe("CopilotRuntime logger option", () => {
  let consoleSpies: {
    [Method in "log" | "debug" | "warn" | "error"]: MockInstance<
      Console[Method]
    >;
  };

  beforeEach(() => {
    consoleSpies = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a failed run's error to the app logger instead of the console", async () => {
    const { logger, calls } = createRecordingLogger();

    await runAgent(createHandler({ logger }), "failing");

    expect(calls).toContainEqual({
      level: "error",
      bindings: {},
      args: [{ err: AGENT_ERROR }, "Error running agent"],
    });
    expect(consoleSpies.error).not.toHaveBeenCalled();
  });

  it("sends a warning to the app logger instead of the console", async () => {
    const { logger, calls } = createRecordingLogger();

    await createHandler({ logger })(new Request("http://localhost/api/info"));

    expect(calls).toContainEqual({
      level: "warn",
      bindings: {},
      args: [
        {
          err: expect.objectContaining({ message: "capabilities unavailable" }),
          agentId: "failing",
        },
        'Failed to fetch capabilities for agent "failing"',
      ],
    });
    expect(consoleSpies.warn).not.toHaveBeenCalled();
  });

  it("sends debug output to a child of the app logger", async () => {
    const { logger, calls } = createRecordingLogger();

    await runAgent(createHandler({ logger, debug: true }), "finishing");

    expect(calls).toContainEqual({
      level: "debug",
      bindings: { component: "copilotkit-debug" },
      args: [
        { agentName: "finishing", threadId: "thread-finishing" },
        "Agent run started",
      ],
    });
    expect(consoleSpies.log).not.toHaveBeenCalled();
  });

  it("accepts console, which has no child, as the logger", async () => {
    await runAgent(
      createHandler({ logger: console, debug: true }),
      "finishing",
    );

    expect(consoleSpies.debug).toHaveBeenCalledWith(
      { agentName: "finishing", threadId: "thread-finishing" },
      "Agent run started",
    );
    // No JSON lines: debug output went to the logger that was passed.
    expect(consoleSpies.log).not.toHaveBeenCalled();
  });

  describe("without a logger", () => {
    it("writes errors to console.error", async () => {
      await runAgent(createHandler(), "failing");

      expect(consoleSpies.error).toHaveBeenCalledWith(
        { err: AGENT_ERROR },
        "Error running agent",
      );
    });

    it("writes debug output as JSON lines on console.log", async () => {
      await runAgent(createHandler({ debug: true }), "finishing");

      const lines = consoleSpies.log.mock.calls.map(([line]) =>
        JSON.parse(String(line)),
      );
      expect(lines).toContainEqual(
        expect.objectContaining({
          level: 20,
          component: "copilotkit-debug",
          agentName: "finishing",
          threadId: "thread-finishing",
          msg: "Agent run started",
        }),
      );
      expect(consoleSpies.debug).not.toHaveBeenCalled();
    });
  });
});
