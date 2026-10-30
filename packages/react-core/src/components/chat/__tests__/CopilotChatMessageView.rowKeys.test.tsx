import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import CopilotChatMessageView from "../CopilotChatMessageView";
import type { Message, ToolCall } from "@ag-ui/core";

const AGENT_ID = "default";
const THREAD_ID = "thread-test";

function toolCall(id: string, name = "approve"): ToolCall {
  return { id, type: "function", function: { name, arguments: "{}" } };
}

function assistantMsg(id: string, content?: string, toolCalls?: ToolCall[]) {
  return { id, role: "assistant" as const, content, toolCalls };
}

function tree(messages: Message[]) {
  return (
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId={THREAD_ID}>
        <CopilotChatMessageView messages={messages} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}

/**
 * Remount-vs-reconcile is only observable by rerendering ONE root and
 * comparing DOM node identity, so these tests build the tree directly rather
 * than using the shared render helper.
 */
function rerenderWith(before: Message[], after: Message[]) {
  const view = render(tree(before));
  const node = screen.getByTestId("copilot-assistant-message");
  view.rerender(tree(after));
  return { node, nodeAfter: screen.getByTestId("copilot-assistant-message") };
}

function duplicateKeyWarnings(spy: ReturnType<typeof vi.spyOn>) {
  // React's message is "two children with the same key", NOT "duplicate key".
  return spy.mock.calls.filter(
    (call) =>
      typeof call[0] === "string" &&
      call[0].includes("two children with the same key"),
  );
}

describe("CopilotChatMessageView stable row keys", () => {
  it("reconciles in place when the message id changes but a tool call is stable", () => {
    const { node, nodeAfter } = rerenderWith(
      [assistantMsg("lc_run--1", "Working...", [toolCall("call_A")])],
      [assistantMsg("resp_1", "Done", [toolCall("call_A")])],
    );

    expect(nodeAfter).toBe(node);
    // Proves React reconciled AND re-rendered, rather than keeping a stale node.
    expect(nodeAfter.textContent).toContain("Done");
  });

  it("does not remount when a tool call arrives on an already-streaming message", () => {
    // Regression guard: keying rows by the tool-call id instead of recording an
    // override remounts here, for every provider, renaming or not.
    const { node, nodeAfter } = rerenderWith(
      [assistantMsg("lc_run--1", "Let me check that...")],
      [assistantMsg("lc_run--1", "Let me check that...", [toolCall("call_A")])],
    );

    expect(nodeAfter).toBe(node);
  });

  it("does not remount when a second tool call arrives", () => {
    const { node, nodeAfter } = rerenderWith(
      [assistantMsg("m1", "hi", [toolCall("call_A")])],
      [assistantMsg("m1", "hi", [toolCall("call_A"), toolCall("call_B", "b")])],
    );

    expect(nodeAfter).toBe(node);
  });

  it("survives the whole sequence: text, then tool call, then id re-key", () => {
    const view = render(tree([assistantMsg("lc_run--1", "Let me check...")]));
    const node = screen.getByTestId("copilot-assistant-message");

    view.rerender(
      tree([
        assistantMsg("lc_run--1", "Let me check...", [toolCall("call_A")]),
      ]),
    );
    expect(screen.getByTestId("copilot-assistant-message")).toBe(node);

    view.rerender(tree([assistantMsg("resp_1", "Done", [toolCall("call_A")])]));
    expect(screen.getByTestId("copilot-assistant-message")).toBe(node);
  });

  it("remounts a text-only message on an id change (documented limitation)", () => {
    // Not a contract: if a future change gives text-only rows a stable anchor,
    // update this to assert in-place reconcile rather than reverting it.
    const { node, nodeAfter } = rerenderWith(
      [assistantMsg("lc_run--1", "Working...")],
      [assistantMsg("resp_1", "Done")],
    );

    expect(nodeAfter).not.toBe(node);
  });

  it("renders both rows without duplicate keys when a tool-call id is shared", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      tree([
        assistantMsg("a-1", "First", [toolCall("call_X")]),
        assistantMsg("a-2", "Second", [toolCall("call_X")]),
      ]),
    );

    const rows = screen.getAllByTestId("copilot-assistant-message");
    expect(rows).toHaveLength(2);
    // Input order is pinned: the first claimant keeps the established key.
    expect(rows[0]!.textContent).toContain("First");
    expect(rows[1]!.textContent).toContain("Second");
    expect(duplicateKeyWarnings(spy)).toHaveLength(0);

    spy.mockRestore();
  });

  it("renders both rows without duplicate keys when an id collides with a vended key", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const view = render(
      tree([assistantMsg("ghost", "First", [toolCall("call_X")])]),
    );
    // "ghost" is now the key recorded for call_X; a later list has a different
    // message carrying call_X plus a message whose own id is "ghost".
    view.rerender(
      tree([
        assistantMsg("live", "First", [toolCall("call_X")]),
        assistantMsg("ghost", "Second"),
      ]),
    );

    expect(screen.getAllByTestId("copilot-assistant-message")).toHaveLength(2);
    expect(duplicateKeyWarnings(spy)).toHaveLength(0);

    spy.mockRestore();
  });

  it("keeps rows stable when the list grows around them", () => {
    const first = assistantMsg("lc_run--1", "First", [toolCall("call_A")]);
    const view = render(tree([first]));
    const node = screen.getByTestId("copilot-assistant-message");

    view.rerender(
      tree([
        { ...first, id: "resp_1" },
        assistantMsg("lc_run--2", "Second", [toolCall("call_B", "b")]),
      ]),
    );

    expect(screen.getAllByTestId("copilot-assistant-message")[0]).toBe(node);
  });
});
