import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import { telemetry } from "..";
import {
  describeAgentIdentity,
  fireAgentIdentifiedTelemetry,
} from "../agent-identified";
import type { CopilotRuntimeLike } from "../../core/runtime";

function makeRuntime(): CopilotRuntimeLike {
  return {} as unknown as CopilotRuntimeLike;
}

type CapabilitiesFn = () => Promise<AgentCapabilities> | AgentCapabilities;

/**
 * A fresh agent class per call. Dedupe is per agent class and name for the
 * whole process, so tests that share a class would share dedupe state.
 */
function agentClass(getCapabilities?: CapabilitiesFn) {
  return class TestAgent {
    getCapabilities = getCapabilities;
  };
}

function makeAgent(getCapabilities?: CapabilitiesFn): AbstractAgent {
  const Agent = agentClass(getCapabilities);
  return new Agent() as unknown as AbstractAgent;
}

describe("describeAgentIdentity", () => {
  it("maps a listed type and keeps a valid adapter version", () => {
    expect(
      describeAgentIdentity(
        { identity: { type: "mastra", metadata: { adapterVersion: "2.0.3" } } },
        false,
      ),
    ).toEqual({
      framework: "mastra",
      adapter_version: "2.0.3",
      via_http_agent: false,
      source: "declared",
    });
  });

  it("lowercases and trims the declared type", () => {
    expect(
      describeAgentIdentity({ identity: { type: " LangGraph " } }, false)
        .framework,
    ).toBe("langgraph");
  });

  it("maps the google-adk-js alias to adk", () => {
    expect(
      describeAgentIdentity({ identity: { type: "google-adk-js" } }, false)
        .framework,
    ).toBe("adk");
  });

  it("sends other for an unlisted type and never the raw text", () => {
    const info = describeAgentIdentity(
      {
        identity: {
          type: "Acme Internal Bot v2",
          name: "secret-name",
          description: "secret-description",
        },
      },
      false,
    );
    expect(info.framework).toBe("other");
    expect(JSON.stringify(info)).not.toMatch(/Acme|secret/);
  });

  it("sends undeclared without capabilities, identity, or type", () => {
    expect(describeAgentIdentity(undefined, true).framework).toBe("undeclared");
    expect(describeAgentIdentity({}, true).framework).toBe("undeclared");
    expect(describeAgentIdentity({ identity: {} }, true).framework).toBe(
      "undeclared",
    );
  });

  it("drops a malformed adapter version", () => {
    expect(
      describeAgentIdentity(
        {
          identity: { type: "mastra", metadata: { adapterVersion: "latest" } },
        },
        false,
      ),
    ).not.toHaveProperty("adapter_version");
  });

  it.each([
    ["2.1.0-beta.1", "2.1.0-beta.1"],
    ["2.1.0-beta-test", "2.1.0-beta-test"],
    // Build metadata can hold arbitrary text, and SemVer ignores it for
    // precedence, so it is dropped.
    ["2.1.0+build.7", "2.1.0"],
  ])("keeps the valid SemVer adapter version %s as %s", (version, sent) => {
    expect(
      describeAgentIdentity(
        { identity: { type: "mastra", metadata: { adapterVersion: version } } },
        false,
      ).adapter_version,
    ).toBe(sent);
  });

  it.each(["01.2.3", "1.2.3-..", "1.2", `1.2.3-${"a".repeat(80)}`])(
    "drops the invalid or overlong adapter version %s",
    (version) => {
      expect(
        describeAgentIdentity(
          {
            identity: { type: "mastra", metadata: { adapterVersion: version } },
          },
          false,
        ),
      ).not.toHaveProperty("adapter_version");
    },
  );

  it("never sends an adapter version for built-in", () => {
    expect(
      describeAgentIdentity(
        {
          identity: { type: "built-in", metadata: { adapterVersion: "1.0.0" } },
        },
        false,
      ),
    ).not.toHaveProperty("adapter_version");
  });
});

describe("fireAgentIdentifiedTelemetry", () => {
  let captureSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
  });

  afterEach(() => {
    captureSpy.mockRestore();
    vi.useRealTimers();
  });

  const identified = () =>
    captureSpy.mock.calls.filter(
      ([event]) => event === "oss.runtime.agent_identified",
    );

  it("captures once per agent class and name", async () => {
    const runtime = makeRuntime();
    const agent = makeAgent(async () => ({ identity: { type: "mastra" } }));
    fireAgentIdentifiedTelemetry({ runtime, agentId: "default", agent });
    fireAgentIdentifiedTelemetry({ runtime, agentId: "default", agent });
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(identified()).toHaveLength(1);
    expect(identified()[0][1]).toEqual({
      framework: "mastra",
      via_http_agent: false,
      source: "declared",
    });
  });

  it("captures once when every request builds a new runtime and new agents of the same class", async () => {
    const getCapabilities = vi.fn(async () => ({
      identity: { type: "mastra" },
    }));
    const Agent = agentClass(getCapabilities);
    for (let i = 0; i < 3; i++) {
      fireAgentIdentifiedTelemetry({
        runtime: makeRuntime(),
        agentId: "default",
        agent: new Agent() as unknown as AbstractAgent,
      });
    }
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(identified()).toHaveLength(1);
    expect(getCapabilities).toHaveBeenCalledTimes(1);
  });

  it("captures again for the same name when the agent class differs", async () => {
    const runtime = makeRuntime();
    const capabilities = async () => ({ identity: { type: "mastra" } });
    fireAgentIdentifiedTelemetry({
      runtime,
      agentId: "a",
      agent: makeAgent(capabilities),
    });
    fireAgentIdentifiedTelemetry({
      runtime,
      agentId: "a",
      agent: makeAgent(capabilities),
    });
    await vi.waitFor(() => expect(identified()).toHaveLength(2));
  });

  it("stops after 100 names for one agent class", async () => {
    const agent = makeAgent(async () => ({ identity: { type: "mastra" } }));
    for (let i = 0; i < 105; i++) {
      fireAgentIdentifiedTelemetry({
        runtime: makeRuntime(),
        agentId: `agent-${i}`,
        agent,
      });
    }
    await vi.waitFor(() => expect(identified()).toHaveLength(100));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(identified()).toHaveLength(100);
  });

  it("reports undeclared when getCapabilities never resolves", async () => {
    vi.useFakeTimers();
    const agent = makeAgent(() => new Promise<AgentCapabilities>(() => {}));
    fireAgentIdentifiedTelemetry({
      runtime: makeRuntime(),
      agentId: "a",
      agent,
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(identified()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(identified()).toHaveLength(1);
    expect(identified()[0][1]).toMatchObject({ framework: "undeclared" });
  });

  it("reports undeclared when getCapabilities throws synchronously, and does not throw", async () => {
    const agent = makeAgent(() => {
      throw new Error("boom");
    });
    expect(() =>
      fireAgentIdentifiedTelemetry({
        runtime: makeRuntime(),
        agentId: "a",
        agent,
      }),
    ).not.toThrow();
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
    expect(identified()[0][1]).toMatchObject({ framework: "undeclared" });
  });

  it("returns before getCapabilities resolves", async () => {
    let resolve: ((value: AgentCapabilities) => void) | undefined;
    const agent = makeAgent(
      () => new Promise<AgentCapabilities>((r) => (resolve = r)),
    );
    const result = fireAgentIdentifiedTelemetry({
      runtime: makeRuntime(),
      agentId: "a",
      agent,
    });
    expect(result).toBeUndefined();
    expect(identified()).toHaveLength(0);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    expect(identified()).toHaveLength(0);
    resolve?.({ identity: { type: "mastra" } });
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
  });

  it("marks a generic HTTP agent", async () => {
    class RemoteAgent {
      url = "https://agent.example/run";
      headers = {};
      abortController = new AbortController();
      runAgent = () => undefined;
    }
    const httpAgent = new RemoteAgent() as unknown as AbstractAgent;
    fireAgentIdentifiedTelemetry({
      runtime: makeRuntime(),
      agentId: "a",
      agent: httpAgent,
    });
    await vi.waitFor(() => expect(identified()).toHaveLength(1));
    expect(identified()[0][1]).toEqual({
      framework: "undeclared",
      via_http_agent: true,
      source: "declared",
    });
  });
});
