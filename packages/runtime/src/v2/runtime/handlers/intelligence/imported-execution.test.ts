import { describe, expect, it } from "vitest";
import { resolveImportedExecution } from "./imported-execution";
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
