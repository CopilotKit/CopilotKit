import { describe, it, expect } from "vitest";
import {
  parseFeedToolResult,
  isOpenBoxResultRecord,
  verdictFromResultRecord,
  findOpenBoxResultContent,
  extractToolCalls,
  toolCallName,
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
  it("returns {} for JSON primitives (number, null)", () => {
    expect(parseFeedToolResult("123")).toEqual({});
    expect(parseFeedToolResult("null")).toEqual({});
  });
  it("returns the parsed array for a JSON array string (typeof [] === object)", () => {
    expect(parseFeedToolResult("[1,2]")).toEqual([1, 2]);
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
  it("maps blocked/block -> block", () => {
    expect(verdictFromResultRecord({ status: "blocked" })).toBe("block");
    expect(verdictFromResultRecord({ verdict: "block" })).toBe("block");
  });
  it("maps approval_pending -> approval (pending approval, not block)", () => {
    expect(verdictFromResultRecord({ status: "approval_pending" })).toBe(
      "approval",
    );
    expect(
      verdictFromResultRecord({ status: "approval_pending", approvalId: "x" }),
    ).toBe("approval");
  });
  it("maps constrained/constrain -> constrain", () => {
    expect(verdictFromResultRecord({ status: "constrained" })).toBe(
      "constrain",
    );
    expect(verdictFromResultRecord({ verdict: "constrain" })).toBe("constrain");
  });
  it("maps require_approval verdict -> approval", () => {
    expect(verdictFromResultRecord({ verdict: "require_approval" })).toBe(
      "approval",
    );
  });
  it("does not force constrain when redactionSummary is empty", () => {
    expect(
      verdictFromResultRecord({ status: "executed", redactionSummary: "" }),
    ).toBe("allow");
  });
  it("ignores redactionSummary unless executed/allow", () => {
    expect(
      verdictFromResultRecord({ status: "blocked", redactionSummary: "pii" }),
    ).toBe("block");
  });
  it("gives status precedence over verdict for rejected/error", () => {
    expect(
      verdictFromResultRecord({ status: "rejected", verdict: "halt" }),
    ).toBe("rejected");
    expect(verdictFromResultRecord({ status: "error", verdict: "block" })).toBe(
      "error",
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
  it("returns null when the matched tool message content is not a string", () => {
    expect(
      findOpenBoxResultContent({ role: "tool", content: { ok: true } }, {}),
    ).toBeNull();
  });
  it("returns null when the snapshot tool message belongs to a non-governed call", () => {
    const assistant = {
      role: "assistant",
      toolCalls: [{ id: "tc1", function: { name: "openbox_governed_action" } }],
    };
    // snapshot has a tool message, but its tool_call_id matches a NON-governed
    // assistant tool call id (tc2), so the governed-id filter must reject it.
    const snapshot = {
      messages: [{ role: "tool", tool_call_id: "tc2", content: '{"ok":true}' }],
    };
    expect(findOpenBoxResultContent(assistant, snapshot)).toBeNull();
  });
});

describe("extractToolCalls", () => {
  it("discovers snake_case tool_calls", () => {
    const message = {
      tool_calls: [
        { id: "tc1", function: { name: "openbox_governed_action" } },
      ],
    };
    expect(extractToolCalls(message)).toEqual([
      { id: "tc1", function: { name: "openbox_governed_action" } },
    ]);
  });
  it("discovers nested additional_kwargs.tool_calls", () => {
    const message = {
      additional_kwargs: {
        tool_calls: [{ id: "tc2", function: { name: "some_tool" } }],
      },
    };
    expect(extractToolCalls(message)).toEqual([
      { id: "tc2", function: { name: "some_tool" } },
    ]);
  });
});

describe("toolCallName", () => {
  it("falls back to the top-level name when there is no function", () => {
    expect(toolCallName({ name: "openbox_governed_action" })).toBe(
      "openbox_governed_action",
    );
  });
});
