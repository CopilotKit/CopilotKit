import { describe, expect, it } from "vitest";
import { isInternalTool, selectRecentToolActivity } from "./tool-activity-recency";

const wildcard = [{ name: "*" }];
const message = (id: string, name = `tool_${id}`) => ({
  id: `message_${id}`,
  role: "assistant",
  toolCalls: [{ id, function: { name } }],
});

describe("conversation-owned tool activity recency", () => {
  it("selects B/C even when a restored viewport encounters B, C, then A", () => {
    const history = [message("a"), message("b"), message("c")];
    const visits = ["b", "c", "a"];
    expect(visits.filter((id) => selectRecentToolActivity(history, wildcard, 2).includes(id)))
      .toEqual(["b", "c"]);
    expect(selectRecentToolActivity(history, wildcard, 2)).toEqual(["b", "c"]);
  });

  it("still lets genuinely new work retire the oldest activity", () => {
    const history = [message("a"), message("b"), message("c")];
    expect(selectRecentToolActivity(history, wildcard, 2)).toEqual(["b", "c"]);
    history.push(message("d"));
    expect(selectRecentToolActivity(history, wildcard, 2)).toEqual(["c", "d"]);
  });

  it("does not reserve slots for protocol tools or exact custom renderers", () => {
    const history = [
      message("a"), message("b"), message("state", "AGUISendStateDelta"),
      message("report", "report"), message("decision", "approve"),
    ];
    expect(selectRecentToolActivity(history,
      [...wildcard, { name: "report" }, { name: "approve" }], 2)).toEqual(["a", "b"]);
  });

  it("recomputes eligibility when a custom renderer is added or removed", () => {
    const history = [message("a"), message("b"), message("c")];
    expect(selectRecentToolActivity(history, [...wildcard, { name: "tool_c" }], 2))
      .toEqual(["a", "b"]);
    expect(selectRecentToolActivity(history, wildcard, 2)).toEqual(["b", "c"]);
  });

  it("reads replacement history rather than retaining deleted calls", () => {
    expect(selectRecentToolActivity([message("a"), message("b"), message("c")], wildcard, 2))
      .toEqual(["b", "c"]);
    expect(selectRecentToolActivity([message("a")], wildcard, 2)).toEqual(["a"]);
    expect(selectRecentToolActivity([], wildcard, 2)).toEqual([]);
  });

  it("preserves order within parallel calls and counts an ID once", () => {
    const history = [{ id: "parallel", role: "assistant", toolCalls: [
      ...message("a").toolCalls, ...message("b").toolCalls, ...message("c").toolCalls,
    ] }, message("c")];
    expect(selectRecentToolActivity(history, wildcard, 2)).toEqual(["b", "c"]);
  });

  it("ignores non-assistant records and does not invent unknown activity", () => {
    const history = [message("a"), { ...message("b"), role: "tool" }];
    expect(selectRecentToolActivity(history, wildcard, 2)).toEqual(["a"]);
    expect(selectRecentToolActivity(history, [], 2)).toEqual([]);
    expect(selectRecentToolActivity(history, wildcard, 0)).toEqual([]);
  });

  it("does not promote a replayed call appended to an earlier parallel batch", () => {
    const history = [{ id: "parallel", role: "assistant", toolCalls: [
      ...message("a").toolCalls, ...message("b").toolCalls,
      ...message("c").toolCalls, ...message("a").toolCalls,
    ] }];
    expect(selectRecentToolActivity(history, wildcard, 2)).toEqual(["b", "c"]);
  });

  it("keeps an updated message at its first position in the transcript", () => {
    const history = [message("a"), message("b"), message("c"), message("a")];
    expect(selectRecentToolActivity(history, wildcard, 2)).toEqual(["b", "c"]);
  });

  it("recovers omitted calls but honors an explicitly empty replacement", () => {
    const history = [message("a"), message("b"), message("c")];
    expect(selectRecentToolActivity([
      ...history, { id: "message_c", role: "assistant" },
    ], wildcard, 2)).toEqual(["b", "c"]);
    expect(selectRecentToolActivity([
      ...history, { id: "message_c", role: "assistant", toolCalls: [] },
    ], wildcard, 2)).toEqual(["a", "b"]);
  });

  it("does not keep calls when their message is replaced by another role", () => {
    const history = [message("a"), message("b"), message("c"),
      { id: "message_c", role: "tool" }];
    expect(selectRecentToolActivity(history, wildcard, 2)).toEqual(["a", "b"]);
  });

  it("uses the populated call before deciding wildcard eligibility", () => {
    const history = [{ id: "parallel", role: "assistant", toolCalls: [
      ...message("a").toolCalls, ...message("b").toolCalls,
      { id: "c", function: { name: "report", arguments: "" } },
      { id: "c", function: { name: "search", arguments: "{}" } },
    ] }];
    expect(selectRecentToolActivity(history, [...wildcard, { name: "report" }], 2))
      .toEqual(["b", "c"]);
  });

  it("keeps the existing internal-tool filter", () => {
    for (const name of ["agui", "AGUISendStateDelta", "a2ui_render", "copilotkit_internal"]) {
      expect(isInternalTool(name)).toBe(true);
    }
    expect(isInternalTool("search")).toBe(false);
  });
});
