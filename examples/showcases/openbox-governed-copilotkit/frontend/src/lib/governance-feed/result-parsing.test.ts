import { describe, it, expect } from "vitest";
import {
  parseFeedToolResult,
  isOpenBoxResultRecord,
  verdictFromResultRecord,
  findOpenBoxResultContent,
} from "./result-parsing";

const RESULT_SCHEMA = "openbox.copilotkit.result.v1";

describe("parseFeedToolResult", () => {
  it("parses a JSON string into a record", () => {
    expect(parseFeedToolResult('{"a":1}')).toEqual({ a: 1 });
  });
  it("returns {} for invalid json / nullish", () => {
    expect(parseFeedToolResult("not json")).toEqual({});
    expect(parseFeedToolResult(undefined)).toEqual({});
    expect(parseFeedToolResult(null)).toEqual({});
  });
  it("passes objects through", () => {
    const obj = { schemaVersion: RESULT_SCHEMA };
    expect(parseFeedToolResult(obj)).toBe(obj);
  });
});

describe("isOpenBoxResultRecord", () => {
  it("accepts only the result schema version", () => {
    expect(isOpenBoxResultRecord({ schemaVersion: RESULT_SCHEMA })).toBe(true);
    expect(isOpenBoxResultRecord({ schemaVersion: "other" })).toBe(false);
    expect(isOpenBoxResultRecord({})).toBe(false);
  });
});

describe("verdictFromResultRecord", () => {
  it("maps approval_required -> approval", () => {
    expect(verdictFromResultRecord({ status: "approval_required" })).toBe(
      "approval",
    );
  });
  it("maps halt + halted", () => {
    expect(verdictFromResultRecord({ verdict: "halt" })).toBe("halt");
    expect(verdictFromResultRecord({ status: "halted" })).toBe("halt");
  });
  it("treats allow + redactionSummary as constrain", () => {
    expect(
      verdictFromResultRecord({
        status: "executed",
        verdict: "allow",
        redactionSummary: "redacted output.artifact.body",
      }),
    ).toBe("constrain");
  });
  it("maps plain executed/allow -> allow", () => {
    expect(verdictFromResultRecord({ status: "executed" })).toBe("allow");
    expect(verdictFromResultRecord({ verdict: "allow" })).toBe("allow");
  });
  it("maps blocked/approval_pending/block -> block", () => {
    expect(verdictFromResultRecord({ status: "blocked" })).toBe("block");
    expect(verdictFromResultRecord({ verdict: "block" })).toBe("block");
    expect(verdictFromResultRecord({ status: "approval_pending" })).toBe(
      "block",
    );
  });
  it("maps error + rejected", () => {
    expect(verdictFromResultRecord({ status: "error" })).toBe("error");
    expect(verdictFromResultRecord({ verdict: "error" })).toBe("error");
    expect(verdictFromResultRecord({ status: "rejected" })).toBe("rejected");
  });
  it("falls back to reviewing", () => {
    expect(verdictFromResultRecord({})).toBe("reviewing");
  });
});

describe("findOpenBoxResultContent", () => {
  it("returns content directly for a tool message", () => {
    expect(findOpenBoxResultContent({ role: "tool", content: "{}" }, {})).toBe(
      "{}",
    );
  });
  it("resolves an assistant governed tool call via the state snapshot", () => {
    const assistant = {
      role: "assistant",
      toolCalls: [{ id: "tc1", function: { name: "openbox_governed_action" } }],
    };
    const snapshot = {
      messages: [{ role: "tool", tool_call_id: "tc1", content: '{"ok":true}' }],
    };
    expect(findOpenBoxResultContent(assistant, snapshot)).toBe('{"ok":true}');
  });
  it("returns null for non-governed assistant calls", () => {
    const assistant = {
      role: "assistant",
      toolCalls: [{ id: "tc1", function: { name: "some_other_tool" } }],
    };
    expect(findOpenBoxResultContent(assistant, { messages: [] })).toBeNull();
  });
});
