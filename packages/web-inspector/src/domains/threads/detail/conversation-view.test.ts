import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationRenderItem } from "./message-adapter.js";
import { renderConversationItems } from "./conversation-view.js";

function renderConversation(
  items: ConversationRenderItem[],
  options: {
    expandedMessages?: Set<string>;
    expandedTools?: Set<string>;
    onToggleMessage?: (id: string) => void;
    onToggleTool?: (id: string) => void;
  } = {},
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(
    renderConversationItems(items, {
      collapseThreshold: 4,
      expandedMessages: options.expandedMessages ?? new Set(),
      expandedTools: options.expandedTools ?? new Set(),
      onToggleMessage: options.onToggleMessage ?? vi.fn(),
      onToggleTool: options.onToggleTool ?? vi.fn(),
    }),
    container,
  );
  return container;
}

afterEach(() => document.body.replaceChildren());

describe("conversation view controls", () => {
  it("renders the message expansion control as an accessible button", () => {
    const onToggleMessage = vi.fn();
    const container = renderConversation(
      [
        {
          id: "message-1",
          type: "assistant",
          content: "A long answer",
          createdAt: "",
        },
      ],
      { onToggleMessage },
    );

    const toggle =
      container.querySelector<HTMLButtonElement>(".cpk-td__show-more");
    expect(toggle?.type).toBe("button");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    toggle?.click();
    expect(onToggleMessage).toHaveBeenCalledWith("message-1");
  });

  it("keeps tool calls pending until a result exists", () => {
    const onToggleTool = vi.fn();
    const pendingTool: ConversationRenderItem = {
      id: "tool-1",
      type: "tool_call",
      toolName: "search",
      toolCallId: "tool-1",
      arguments: { query: "CopilotKit" },
      result: null,
      createdAt: "",
    };
    const container = renderConversation([pendingTool], { onToggleTool });

    const toggle = container.querySelector<HTMLButtonElement>(
      ".cpk-td__tool-header",
    );
    expect(toggle?.type).toBe("button");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".cpk-td__tool-status")?.textContent).toBe(
      "PENDING",
    );

    toggle?.click();
    expect(onToggleTool).toHaveBeenCalledWith("tool-1");

    renderConversation([{ ...pendingTool, result: {} }]);
    const statuses = Array.from(
      document.querySelectorAll(".cpk-td__tool-status"),
    );
    expect(statuses.at(-1)?.textContent).toBe("DONE");
  });
});
