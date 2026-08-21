/**
 * v1-path half of the #1982 / #2051 reproduction.
 *
 * Both reporters use v1 `useCopilotAction({ available: "disabled", render })`.
 * That hook is now a shim that routes `available: "disabled"` and `name: "*"`
 * to the same `useRenderToolCall` registration v2 uses, so the status/result
 * derivation is shared. What is NOT shared is the v1 *display* seam:
 * `useLazyToolRenderer`, which picks `message.toolCalls[0]`.
 *
 * #2051's backend runs asyncio.gather over every tool_call on the assistant
 * message, so parallel tool calls are exactly its shape. This pins down what
 * the v1 seam does with more than one.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { useLazyToolRenderer } from "../use-lazy-tool-renderer";
import { CopilotKitProvider } from "../../v2/providers/CopilotKitProvider";
import type { AIMessage, Message } from "@copilotkit/shared";

const WildcardRender: React.FC<any> = ({ name, status, result }) => (
  <div data-testid={`v1-${name}`}>
    {name}:{status}:{String(result ?? "")}
  </div>
);

function Harness({
  message,
  messages,
}: {
  message: AIMessage;
  messages: Message[];
}) {
  const lazy = useLazyToolRenderer();
  const rendered = lazy(message, messages);
  return <div data-testid="host">{rendered ? rendered() : null}</div>;
}

function renderV1({
  message,
  messages,
}: {
  message: AIMessage;
  messages: Message[];
}) {
  return render(
    <CopilotKitProvider
      renderToolCalls={
        [
          {
            name: "*",
            args: z.object({ toolName: z.string(), args: z.unknown() }),
            render: WildcardRender,
          },
        ] as any
      }
    >
      <Harness message={message} messages={messages} />
    </CopilotKitProvider>,
  );
}

function assistantWithToolCalls(names: string[]): AIMessage {
  return {
    id: "a1",
    role: "assistant",
    content: "",
    toolCalls: names.map((n, i) => ({
      id: `tc${i + 1}`,
      type: "function",
      function: { name: n, arguments: JSON.stringify({ x: i + 1 }) },
    })),
  } as any;
}

function toolResult(toolCallId: string, content: string): Message {
  return {
    id: `tm-${toolCallId}`,
    role: "tool",
    toolCallId,
    content,
  } as any;
}

describe("v1 path (#1982 / #2051) — useLazyToolRenderer", () => {
  it("single backend tool call reaches complete with its result", async () => {
    const message = assistantWithToolCalls(["get_weather"]);
    renderV1({
      message,
      messages: [message, toolResult("tc1", "sunny, 22C")],
    });

    await waitFor(() => {
      expect(screen.getByTestId("v1-get_weather").textContent).toContain(
        "sunny, 22C",
      );
    });
    expect(screen.getByTestId("v1-get_weather").textContent).toContain(
      "complete",
    );
  });

  it("renders every parallel tool call, not just the first", async () => {
    const message = assistantWithToolCalls(["tool_one", "tool_two"]);
    renderV1({
      message,
      messages: [
        message,
        toolResult("tc1", "one-done"),
        toolResult("tc2", "two-done"),
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId("v1-tool_one").textContent).toContain(
        "one-done",
      );
    });
    // If the v1 seam only reads toolCalls[0], the second tool call never renders.
    expect(screen.queryByTestId("v1-tool_two")).not.toBeNull();
  });
});
