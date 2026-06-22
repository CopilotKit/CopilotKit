/**
 * Trust-hinge tests for the run-forward path in
 * `packages/runtime/src/v2/runtime/handlers/intelligence/run.ts`.
 *
 * The BFF must OVERWRITE the reserved `permitted` key
 * (`__copilotkit_intelligence_permitted_containers__`) on every forwarded
 * run's `forwardedProps` with the trusted `writableContainers` resolved
 * server-side from `identifyUser`. A client cannot forge write authority by
 * putting this key in `forwardedProps`.
 *
 * These assert on the input the runner receives — that input is what the
 * IntelligenceAgentRunner forwards to the Intelligence platform as the
 * canonical RUN_STARTED event, so it is the authoritative forwarded value.
 */
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { Observable } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { handleRunAgent } from "../handlers/handle-run";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import { telemetry } from "../telemetry";
import { INTELLIGENCE_PERMITTED_CONTAINERS_KEY } from "../intelligence-platform/client";
import type { CopilotRuntime } from "../core/runtime";
import type { AgentRunnerRunRequest } from "../runner/agent-runner";

const PERMITTED_KEY = INTELLIGENCE_PERMITTED_CONTAINERS_KEY;
const INTENDED_KEY = "__copilotkit_intelligence_learning_containers__";

interface MockIntelligencePlatform {
  [key: string]: ((...args: any[]) => any) | undefined;
}

type IdentifiedUser = {
  id: string;
  name: string;
  learningContainers?: {
    readableContainers?: string[];
    writableContainers?: string[];
  };
};

function makeAgent(): AbstractAgent {
  const agent: any = {
    clone: vi.fn(() => agent),
    setMessages: vi.fn(),
    setState: vi.fn(),
    threadId: undefined,
    headers: {},
    runAgent: vi.fn().mockResolvedValue(undefined),
  };
  return agent as AbstractAgent;
}

function setup(options: {
  identifiedUser: IdentifiedUser;
  forwardedProps: Record<string, unknown>;
}) {
  // Never-completing observable so the run stays "started" without finishing.
  const never = new Observable<BaseEvent>(() => {});
  const runSpy = vi.fn((_request: AgentRunnerRunRequest) => never);

  const runner = Object.create(IntelligenceAgentRunner.prototype);
  runner.run = runSpy;

  const platform: MockIntelligencePlatform = {
    getOrCreateThread: vi.fn().mockResolvedValue({
      thread: { id: "thread-1", name: "named" },
      created: false,
    }),
    getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
    ɵacquireThreadLock: vi.fn().mockResolvedValue({
      threadId: "thread-1",
      runId: "run-1",
      joinToken: "jt-1",
    }),
    ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
    ɵgetClientWsUrl: vi.fn(() => "wss://runtime.example/client"),
    ɵrenewThreadLock: vi.fn().mockResolvedValue(undefined),
  };

  const runtime = {
    agents: Promise.resolve({ "my-agent": makeAgent() }),
    transcriptionService: undefined,
    beforeRequestMiddleware: undefined,
    afterRequestMiddleware: undefined,
    runner,
    mode: "intelligence",
    generateThreadNames: false,
    intelligence: platform,
    identifyUser: vi.fn().mockResolvedValue(options.identifiedUser),
    lockTtlSeconds: 20,
    lockHeartbeatIntervalSeconds: 15,
  } as unknown as CopilotRuntime;

  const request = new Request("https://example.com/agent/my-agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: options.forwardedProps,
    }),
  });

  const forwardedProps = () =>
    (runSpy.mock.calls[0]![0] as { input: { forwardedProps: Record<string, unknown> } })
      .input.forwardedProps;

  return { runtime, request, runSpy, forwardedProps };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("OVERWRITES a client-forged permitted key with the server-resolved allowlist", async () => {
  const { runtime, request, forwardedProps } = setup({
    identifiedUser: {
      id: "user-1",
      name: "User One",
      learningContainers: { writableContainers: ["team-a"] },
    },
    // Client tries to forge admin write authority.
    forwardedProps: { [PERMITTED_KEY]: ["admin"] },
  });

  await handleRunAgent({ runtime, request, agentId: "my-agent" });

  expect(forwardedProps()[PERMITTED_KEY]).toEqual(["team-a"]);
});

it("strips a client-forged permitted key when writableContainers is unconfigured (unrestricted)", async () => {
  const { runtime, request, forwardedProps } = setup({
    identifiedUser: { id: "user-1", name: "User One" },
    forwardedProps: { [PERMITTED_KEY]: ["admin"] },
  });

  await handleRunAgent({ runtime, request, agentId: "my-agent" });

  expect(PERMITTED_KEY in forwardedProps()).toBe(false);
});

it("stamps permitted = [] (write nowhere) when writableContainers is []", async () => {
  const { runtime, request, forwardedProps } = setup({
    identifiedUser: {
      id: "user-1",
      name: "User One",
      learningContainers: { writableContainers: [] },
    },
    forwardedProps: {},
  });

  await handleRunAgent({ runtime, request, agentId: "my-agent" });

  expect(forwardedProps()[PERMITTED_KEY]).toEqual([]);
});

it("leaves the client-owned intended key untouched while stamping permitted", async () => {
  const { runtime, request, forwardedProps } = setup({
    identifiedUser: {
      id: "user-1",
      name: "User One",
      learningContainers: { writableContainers: ["team-a"] },
    },
    forwardedProps: {
      [INTENDED_KEY]: ["team-b"],
      [PERMITTED_KEY]: ["admin"],
      other: "kept",
    },
  });

  await handleRunAgent({ runtime, request, agentId: "my-agent" });

  const props = forwardedProps();
  expect(props[INTENDED_KEY]).toEqual(["team-b"]);
  expect(props[PERMITTED_KEY]).toEqual(["team-a"]);
  expect(props.other).toBe("kept");
});
