import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { TOOL_CALL_RENDERERS, ToolActivityProvider } from "./tool-activity";

// Keep React and the real provider/rows. Only the framework-owned sources and
// skin are fixtures; notifications exercise the actual external-store binding.
const source = vi.hoisted(() => {
  const messageListeners = new Set<() => void>();
  const rendererListeners = new Set<() => void>();
  return {
    messageListeners,
    rendererListeners,
    agent: {
      messages: [] as {
        role: string;
        toolCalls: { id: string; function: { name: string } }[];
      }[],
      subscribe({ onMessagesChanged }: { onMessagesChanged: () => void }) {
        messageListeners.add(onMessagesChanged);
        return { unsubscribe: () => messageListeners.delete(onMessagesChanged) };
      },
    },
    core: {
      renderToolCalls: [{ name: "*" }],
      subscribe({ onRenderToolCallsChanged }: { onRenderToolCallsChanged: () => void }) {
        rendererListeners.add(onRenderToolCallsChanged);
        return { unsubscribe: () => rendererListeners.delete(onRenderToolCallsChanged) };
      },
    },
  };
});

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({ agent: source.agent }),
  useCopilotKit: () => ({ copilotkit: source.core }),
  defineToolCallRenderer: (renderer: unknown) => renderer,
  ToolCallStatus: { Complete: "complete" },
}));
vi.mock("@/shell/skin-provider", () => ({
  useSkin: () => ({ toolLabels: {} }),
}));

const message = (id: string) => ({
  role: "assistant",
  toolCalls: [{ id, function: { name: `tool_${id}` } }],
});
const Renderer = TOOL_CALL_RENDERERS[0].render;

function Window({ ids, thread = "one" }: { ids: string[]; thread?: string }) {
  return (
    <StrictMode>
      <ToolActivityProvider key={thread}>
        {ids.map((id) => (
          <Renderer key={id} name={`tool_${id}`} toolCallId={id}
            status={ToolCallStatus.Complete} args={{}} result="done" />
        ))}
      </ToolActivityProvider>
    </StrictMode>
  );
}

const visible = () => screen.queryAllByRole("button").map((button) => button.textContent?.trim());

beforeEach(() => {
  source.agent.messages = [message("a"), message("b"), message("c")];
  source.core.renderToolCalls = [{ name: "*" }];
});
afterEach(() => {
  cleanup();
  expect(source.messageListeners.size).toBe(0);
  expect(source.rendererListeners.size).toBe(0);
});

describe("rolling activity projection", () => {
  it("does not promote older history first mounted after a restored tail", () => {
    const view = render(<Window ids={["b", "c"]} />);
    expect(visible()).toEqual(["Tool b", "Tool c"]);
    view.rerender(<Window ids={["a", "b", "c"]} />);
    expect(visible()).toEqual(["Tool b", "Tool c"]);
  });

  it("is stable when an already-seen older row unmounts and remounts", () => {
    const view = render(<Window ids={["a", "b", "c"]} />);
    view.rerender(<Window ids={["b", "c"]} />);
    view.rerender(<Window ids={["a", "b", "c"]} />);
    expect(visible()).toEqual(["Tool b", "Tool c"]);
  });

  it("responds to new conversation work even when the array is mutated in place", () => {
    render(<Window ids={["a", "b", "c", "d"]} />);
    expect(visible()).toEqual(["Tool b", "Tool c"]);
    act(() => {
      source.agent.messages.push(message("d"));
      source.messageListeners.forEach((notify) => notify());
    });
    expect(visible()).toEqual(["Tool c", "Tool d"]);
    expect(screen.queryAllByTestId("tool-activity")).toHaveLength(2);
  });

  it("updates the wildcard budget when a richer renderer registers", () => {
    render(<Window ids={["a", "b", "c"]} />);
    act(() => {
      source.core.renderToolCalls = [{ name: "*" }, { name: "tool_c" }];
      source.rendererListeners.forEach((notify) => notify());
    });
    expect(visible()).toEqual(["Tool a", "Tool b"]);
    act(() => {
      source.core.renderToolCalls = [{ name: "*" }];
      source.rendererListeners.forEach((notify) => notify());
    });
    expect(visible()).toEqual(["Tool b", "Tool c"]);
  });

  it("does not retain recency from a previous thread or removed history", () => {
    const view = render(<Window ids={["a", "b", "c"]} />);
    source.agent.messages = [message("a")];
    view.rerender(<Window ids={["a"]} thread="two" />);
    expect(visible()).toEqual(["Tool a"]);
    act(() => {
      source.agent.messages = [];
      source.messageListeners.forEach((notify) => notify());
    });
    expect(visible()).toEqual([]);
  });
});
