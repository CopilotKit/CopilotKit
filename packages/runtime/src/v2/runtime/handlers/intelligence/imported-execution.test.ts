import { describe, expect, it } from "vitest";
import { resolveImportedExecution } from "./imported-execution";
import { HttpAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";

const input: RunAgentInput = {
  threadId: "canonical",
  runId: "run",
  messages: [],
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
};
const native = {
  version: 1,
  status: "ready",
  source: "langgraph",
  agentId: "support",
  threadId: "native:thread",
  context: {},
};

describe("imported execution", () => {
  it("preserves ordinary and older platform behavior", () => {
    expect(resolveImportedExecution(undefined, "support", input)).toBe(input);
    expect(resolveImportedExecution(null, "support", input)).toBe(input);
  });
  it("uses only the authorized descriptor for native routing", () => {
    const result = resolveImportedExecution(native, "support", {
      ...input,
      forwardedProps: { nativeThreadId: "attacker" },
    });
    expect(result.threadId).toBe("native:thread");
    expect(result.runId).toBe(input.runId);
    expect(input.threadId).toBe("canonical");
  });
  it("rejects another mapped agent and unknown descriptor versions", () => {
    expect(() => resolveImportedExecution(native, "other", input)).toThrow(
      "mapped agent",
    );
    expect(() =>
      resolveImportedExecution({ ...native, version: 2 }, "support", input),
    ).toThrow("Update");
  });
  it("reports a repair action when source identity is incomplete", () => {
    expect(() =>
      resolveImportedExecution(
        {
          version: 1,
          status: "unavailable",
          code: "IMPORT_EXECUTION_CONTEXT_MISSING",
          message: "Re-import with Replace",
        },
        "support",
        input,
      ),
    ).toThrow("Re-import with Replace");
  });
  it("requires preparation for framework-specific context instead of guessing", () => {
    expect(() =>
      resolveImportedExecution(
        { ...native, source: "adk", context: { userId: "native-user" } },
        "support",
        input,
      ),
    ).toThrow("prepareImportedThread");
  });
});

class LocalMastraAdapter extends HttpAgent {
  agent = { id: "backend-agent", getMemory: () => ({}) };
  resourceId: string | undefined = "resource";
  isLocalMastraAgent(value: unknown): boolean {
    return value === this.agent;
  }
}
const mappedAdk = {
  ...native,
  source: "adk",
  context: {
    appName: "app",
    userId: "user",
    sessionId: "session",
    sessionLookup: "ag-ui-thread",
  },
};
const mastra = {
  ...native,
  source: "mastra",
  context: { agentId: "backend-agent", resourceId: "resource" },
};
it("continues an AG-UI mapped ADK session using its existing mapped adapter", () => {
  expect(resolveImportedExecution(mappedAdk, "support", input).threadId).toBe(
    native.threadId,
  );
});
it("requires preparation for direct native ADK and incomplete mapped context", () => {
  for (const context of [
    { ...mappedAdk.context, sessionLookup: "session-id" },
    { sessionLookup: "ag-ui-thread" },
  ]) {
    expect(() =>
      resolveImportedExecution({ ...mappedAdk, context }, "support", input),
    ).toThrow("prepareImportedThread");
  }
});
it("accepts matching local Mastra configuration without a hook or mutation", () => {
  const agent = new LocalMastraAdapter({ url: "http://unused.invalid" });
  expect(
    resolveImportedExecution(mastra, "support", input, false, agent).threadId,
  ).toBe(native.threadId);
  expect(agent.resourceId).toBe("resource");
});
it("requires preparation when Mastra's agent/resource/local context does not match", () => {
  const agent = new LocalMastraAdapter({ url: "http://unused.invalid" });
  for (const context of [
    { ...mastra.context, agentId: "other" },
    { ...mastra.context, resourceId: "other" },
  ]) {
    expect(() =>
      resolveImportedExecution(
        { ...mastra, context },
        "support",
        input,
        false,
        agent,
      ),
    ).toThrow("prepareImportedThread");
  }
  agent.isLocalMastraAgent = () => {
    throw new Error("bad context");
  };
  expect(() =>
    resolveImportedExecution(mastra, "support", input, false, agent),
  ).toThrow("prepareImportedThread");
  expect(() =>
    resolveImportedExecution(
      mastra,
      "support",
      input,
      false,
      new HttpAgent({ url: "http://unused.invalid" }),
    ),
  ).toThrow("prepareImportedThread");
});
