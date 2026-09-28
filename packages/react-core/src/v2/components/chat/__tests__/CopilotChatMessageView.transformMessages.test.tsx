import React from "react";
import { act, cleanup, screen } from "@testing-library/react";
import { z } from "zod";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import type { Virtualizer } from "@tanstack/react-virtual";
import type * as ReactVirtual from "@tanstack/react-virtual";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import { defineToolCallRenderer } from "../../../types";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { ScrollElementContext } from "../scroll-element-context";

/**
 * `transformMessages` reshapes the list before anything downstream sees it:
 * row keys, the virtualization count, and rendering all work off its output.
 * Tool-result lookups deliberately keep using the untransformed list, so a
 * transform that hides tool results does not strip them from tool cards.
 */

type CapturedVirtualizer = Virtualizer<HTMLElement, Element>;

const capture = vi.hoisted(() => ({
  current: null as CapturedVirtualizer | null,
}));

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactVirtual>();
  return {
    ...actual,
    // The real hook still runs; this only keeps a reference to its result.
    useVirtualizer: ((options: Parameters<typeof actual.useVirtualizer>[0]) => {
      const instance = actual.useVirtualizer(options);
      capture.current = instance as unknown as CapturedVirtualizer;
      return instance;
    }) as unknown as typeof actual.useVirtualizer,
  };
});

/**
 * jsdom reports no layout, and the message view only virtualizes inside a
 * scroll container with a real height. This one claims 600px.
 */
function createScrollElement(): HTMLDivElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientHeight", {
    get: () => 600,
    configurable: true,
  });
  element.getBoundingClientRect = () =>
    ({
      height: 600,
      width: 800,
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return element;
}

function userMessages(count: number, prefix = "m"): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    role: "user" as const,
    content: `${prefix} ${i}`,
  }));
}

function virtualizedRowCount(): number {
  if (!capture.current) {
    throw new Error("CopilotChatMessageView did not build a virtualizer");
  }
  return capture.current.options.count;
}

/** TanStack schedules measurement frames; let them run before teardown. */
async function drainAnimationFrames() {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}

afterEach(() => {
  cleanup();
  capture.current = null;
  vi.restoreAllMocks();
});

describe("CopilotChatMessageView transformMessages", () => {
  it("renders only the messages the transform returns", () => {
    const messages = userMessages(4);

    renderWithCopilotKit({
      children: (
        <CopilotChatMessageView
          messages={messages}
          transformMessages={(list) => list.filter((m) => m.id !== "m-1")}
        />
      ),
    });

    expect(screen.queryByText("m 0")).not.toBeNull();
    expect(screen.queryByText("m 1")).toBeNull();
    expect(screen.queryByText("m 2")).not.toBeNull();
  });

  it("receives the deduplicated list, not the raw one", () => {
    const received: string[][] = [];
    const duplicate: Message = { id: "m-0", role: "user", content: "m 0" };

    renderWithCopilotKit({
      children: (
        <CopilotChatMessageView
          messages={[...userMessages(2), duplicate]}
          transformMessages={(list) => {
            received.push(list.map((m) => m.id));
            return list;
          }}
        />
      ),
    });

    expect(received.at(-1)).toEqual(["m-0", "m-1"]);
  });

  it("counts virtualized rows from the transformed list", async () => {
    const scrollElement = createScrollElement();

    renderWithCopilotKit({
      children: (
        <ScrollElementContext.Provider value={scrollElement}>
          <CopilotChatMessageView
            messages={[...userMessages(60), ...userMessages(20, "hidden")]}
            transformMessages={(list) =>
              list.filter((m) => !m.id.startsWith("hidden"))
            }
          />
        </ScrollElementContext.Provider>
      ),
    });

    expect(virtualizedRowCount()).toBe(60);
    await drainAnimationFrames();
  });

  it("applies the virtualization threshold to the transformed list", async () => {
    const scrollElement = createScrollElement();

    // 60 in, 40 out: below the threshold, so the view stays flat.
    renderWithCopilotKit({
      children: (
        <ScrollElementContext.Provider value={scrollElement}>
          <CopilotChatMessageView
            messages={userMessages(60)}
            transformMessages={(list) => list.slice(20)}
          />
        </ScrollElementContext.Provider>
      ),
    });

    expect(virtualizedRowCount()).toBe(0);
    await drainAnimationFrames();
  });

  it("keeps tool results available to tool cards when the transform hides them", () => {
    const assistant: AssistantMessage = {
      id: "a-1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "getWeather", arguments: '{"location":"Paris"}' },
        },
      ],
    };
    const toolResult: ToolMessage = {
      id: "t-1",
      role: "tool",
      toolCallId: "call-1",
      content: "sunny",
    };

    renderWithCopilotKit({
      renderToolCalls: [
        defineToolCallRenderer({
          name: "getWeather",
          args: z.object({ location: z.string() }),
          render: ({ result }) => (
            <span data-testid="weather-result">
              {result ? String(result) : "pending"}
            </span>
          ),
        }),
      ],
      children: (
        <CopilotChatMessageView
          messages={[assistant, toolResult]}
          transformMessages={(list) => list.filter((m) => m.role !== "tool")}
        />
      ),
    });

    expect(screen.getByTestId("weather-result").textContent).toBe("sunny");
  });

  describe("virtualization warning", () => {
    it("warns once when a custom layout is what turned virtualization off", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const scrollElement = createScrollElement();

      let setMessages: ((next: Message[]) => void) | null = null;
      function Harness() {
        const [messages, update] = React.useState(userMessages(60));
        setMessages = update;
        return (
          <ScrollElementContext.Provider value={scrollElement}>
            <CopilotChatMessageView messages={messages}>
              {({ messageElements }) => <div>{messageElements}</div>}
            </CopilotChatMessageView>
          </ScrollElementContext.Provider>
        );
      }

      renderWithCopilotKit({ children: <Harness /> });
      // A later render with the custom layout still in place must not repeat it.
      act(() => setMessages!(userMessages(61)));

      const virtualizationWarnings = warn.mock.calls.filter(([text]) =>
        String(text).includes("disables virtualization"),
      );
      expect(virtualizationWarnings).toHaveLength(1);
      await drainAnimationFrames();
    });

    it("stays quiet below the threshold, where virtualization would be off anyway", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      renderWithCopilotKit({
        children: (
          <ScrollElementContext.Provider value={createScrollElement()}>
            <CopilotChatMessageView messages={userMessages(10)}>
              {({ messageElements }) => <div>{messageElements}</div>}
            </CopilotChatMessageView>
          </ScrollElementContext.Provider>
        ),
      });

      expect(
        warn.mock.calls.some(([text]) =>
          String(text).includes("disables virtualization"),
        ),
      ).toBe(false);
    });

    it("stays quiet without a custom layout", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      renderWithCopilotKit({
        children: (
          <ScrollElementContext.Provider value={createScrollElement()}>
            <CopilotChatMessageView messages={userMessages(60)} />
          </ScrollElementContext.Provider>
        ),
      });

      expect(
        warn.mock.calls.some(([text]) =>
          String(text).includes("disables virtualization"),
        ),
      ).toBe(false);
      await drainAnimationFrames();
    });
  });
});
