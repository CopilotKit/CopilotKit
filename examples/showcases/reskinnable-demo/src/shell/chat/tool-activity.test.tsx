import { StrictMode } from "react";
import type { ComponentProps, ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { SubagentFilteredAssistantMessage } from "@/shell/subagents/subagent-message-filter";
import { TOOL_CALL_RENDERERS } from "./tool-activity";

type Tool = { id: string; function: { name: string } };
type Message = { id: string; content: string; toolCalls: Tool[] };
type ActivityProps = {
  toolCallId: string;
  name: string;
  status: ToolCallStatus;
  args: { id: string };
  result: string;
};

const subagents = vi.hoisted(() => ({ subagentMessageIds: new Set<string>() }));

vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ toolLabels: undefined }),
}));
vi.mock("@/shell/subagents/subagent-activity", () => ({
  useSubagentActivity: () => subagents,
}));
vi.mock("@copilotkit/react-core/v2", () => ({
  ToolCallStatus: { Complete: "complete" },
  defineToolCallRenderer: (definition: unknown) => definition,
  CopilotChatAssistantMessage: (props: { message: Message }) => (
    <SdkAssistantMessage {...props} />
  ),
}));

/**
 * The SDK boundary supplies message/tool fixtures only. The real wildcard
 * renderer, row state, recency subscription, and assistant-message filter all
 * run together, so a row-only fix cannot pass by leaving its parent hidden.
 */
function SdkAssistantMessage({ message }: { message: Message }) {
  const renderActivity = TOOL_CALL_RENDERERS[0].render as (
    props: ActivityProps,
  ) => ReactNode;
  return (
    <article data-testid={`message-${message.id}`}>
      {message.content}
      {message.toolCalls.map((call) => (
        <div key={call.id}>
          {renderActivity({
            toolCallId: call.id,
            name: call.function.name,
            status: ToolCallStatus.Complete,
            args: { id: call.id },
            result: `result-${call.id}`,
          })}
        </div>
      ))}
    </article>
  );
}

function Transcript({ messages }: { messages: Message[] }) {
  return (
    <StrictMode>
      {messages.map((message) => (
        <SubagentFilteredAssistantMessage
          key={message.id}
          {...({ message } as unknown as ComponentProps<
            typeof SubagentFilteredAssistantMessage
          >)}
        />
      ))}
    </StrictMode>
  );
}

const tool = (id: string, name = `tool_${id}`): Tool => ({
  id,
  function: { name },
});
const message = (id: string, calls: Tool[], content = ""): Message => ({
  id,
  content,
  toolCalls: calls,
});
const button = (id: string) =>
  screen.getByRole("button", { name: `Tool ${id}` });
const queryButton = (id: string) =>
  screen.queryByRole("button", { name: `Tool ${id}` });

// This app has no jest-dom matchers. Check ancestors as well as the row: an
// expanded detail can exist in the DOM while HideWhenEmpty hides its message.
function messageIsVisible(id: string): boolean {
  let element: HTMLElement | null = screen.getByTestId(`message-${id}`);
  while (element) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    element = element.parentElement;
  }
  return true;
}

beforeEach(() => subagents.subagentMessageIds.clear());
afterEach(() => cleanup());

describe("expanded tool activity", () => {
  it.each([
    { kind: "text-bearing", content: "Assistant narration" },
    { kind: "tool-only", content: "" },
  ])(
    "keeps an inspected row visible in a $kind message until it is collapsed",
    ({ content }) => {
      const initial = message("a", [tool("a")], content);
      const { rerender } = render(<Transcript messages={[initial]} />);
      fireEvent.click(button("a"));
      expect(button("a").getAttribute("aria-expanded")).toBe("true");

      rerender(
        <Transcript
          messages={[
            initial,
            message("b", [tool("b")]),
            message("c", [tool("c")]),
          ]}
        />,
      );

      expect(messageIsVisible("a")).toBe(true);
      expect(button("a").getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText(/output: result-a/).textContent).toContain(
        "output: result-a",
      );
      expect(button("b")).toBeDefined();
      expect(button("c")).toBeDefined();

      fireEvent.click(button("a"));
      expect(queryButton("a")).toBeNull();
      expect(screen.queryByText(/output: result-a/)).toBeNull();
      expect(messageIsVisible("a")).toBe(content.length > 0);
    },
  );

  it("keeps a message visible until all of its inspected rows are collapsed", () => {
    const initial = message("inspected", [tool("a"), tool("b")]);
    const { rerender } = render(<Transcript messages={[initial]} />);
    fireEvent.click(button("a"));
    fireEvent.click(button("b"));
    rerender(
      <Transcript
        messages={[initial, message("new", [tool("c"), tool("d")])]}
      />,
    );

    expect(messageIsVisible("inspected")).toBe(true);
    expect(button("a").getAttribute("aria-expanded")).toBe("true");
    expect(button("b").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button("a"));
    expect(queryButton("a")).toBeNull();
    expect(messageIsVisible("inspected")).toBe(true);
    expect(button("b").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button("b"));
    expect(queryButton("b")).toBeNull();
    expect(messageIsVisible("inspected")).toBe(false);
  });

  it("releases inspection on unmount and does not pin a collapsed remount", () => {
    const passive = tool("x");
    const later = message("later", [tool("c"), tool("d")]);
    const { rerender } = render(
      <Transcript messages={[message("target", [tool("a"), passive])]} />,
    );
    fireEvent.click(button("a"));
    rerender(
      <Transcript
        messages={[message("target", [tool("a"), passive]), later]}
      />,
    );
    expect(messageIsVisible("target")).toBe(true);
    expect(button("a").getAttribute("aria-expanded")).toBe("true");

    rerender(
      <Transcript messages={[message("target", [passive]), later]} />,
    );
    expect(messageIsVisible("target")).toBe(false);

    rerender(
      <Transcript
        messages={[message("target", [passive, tool("a")]), later]}
      />,
    );
    expect(button("a").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/output: result-a/)).toBeNull();
    rerender(
      <Transcript
        messages={[
          message("target", [passive, tool("a")]),
          later,
          message("newest", [tool("e"), tool("f")]),
        ]}
      />,
    );
    expect(queryButton("a")).toBeNull();
    expect(messageIsVisible("target")).toBe(false);
  });

  it("still retires unopened rows and their empty messages", () => {
    const initial = message("a", [tool("a")]);
    const { rerender } = render(<Transcript messages={[initial]} />);
    expect(button("a").getAttribute("aria-expanded")).toBe("false");
    rerender(
      <Transcript
        messages={[initial, message("later", [tool("b"), tool("c")])]}
      />,
    );
    expect(queryButton("a")).toBeNull();
    expect(messageIsVisible("a")).toBe(false);
    expect(screen.getAllByRole("button").map((item) => item.textContent)).toEqual(
      ["Tool b", "Tool c"],
    );
  });

  it("does not let hidden protocol tools consume the passive activity window", () => {
    render(
      <Transcript
        messages={[
          message("a", [tool("a")]),
          message("internal", [
            tool("internal-1", "AGUISendStateDelta"),
            tool("internal-2", "copilotkit_internal"),
          ]),
          message("b", [tool("b")]),
        ]}
      />,
    );
    expect(screen.getAllByRole("button").map((item) => item.textContent)).toEqual(
      ["Tool a", "Tool b"],
    );
    expect(messageIsVisible("internal")).toBe(false);
  });

  it("preserves inspection while suppressing a subagent's narration", () => {
    subagents.subagentMessageIds.add("subagent");
    const initial = message("subagent", [tool("a")], "Private narration");
    const { rerender } = render(<Transcript messages={[initial]} />);
    expect(screen.queryByText("Private narration")).toBeNull();
    fireEvent.click(button("a"));
    rerender(
      <Transcript
        messages={[initial, message("later", [tool("b"), tool("c")])]}
      />,
    );
    expect(messageIsVisible("subagent")).toBe(true);
    expect(button("a").getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("Private narration")).toBeNull();
    fireEvent.click(button("a"));
    expect(messageIsVisible("subagent")).toBe(false);
  });
});
