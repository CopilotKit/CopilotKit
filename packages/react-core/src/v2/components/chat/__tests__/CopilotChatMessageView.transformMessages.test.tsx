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

// Replaces both assistant messages with one it builds, under a new id.
const mergeAssistants = (list: Message[]): Message[] => [
  {
    id: "merged",
    role: "assistant",
    content: list
      .filter((m) => m.role === "assistant")
      .map((m) => m.content)
      .join(" "),
  },
];

const dropFirst = (list: Message[]): Message[] => list.slice(1);

// Drops a stand-in once a real message carries the same call.
const dropStandIns = (list: Message[]): Message[] =>
  list.filter(
    (m) =>
      !list.some(
        (other) =>
          other !== m &&
          other.role === "assistant" &&
          other.toolCalls?.some((tc) => tc.id === m.id),
      ),
  );

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

  describe("latest message", () => {
    const first: AssistantMessage = {
      id: "a-1",
      role: "assistant",
      content: "first half",
    };
    const second: AssistantMessage = {
      id: "a-2",
      role: "assistant",
      content: "second half",
    };
    it("treats the last rendered message as the latest, not the last input message", () => {
      let setRunning: ((next: boolean) => void) | null = null;
      function Harness() {
        const [isRunning, update] = React.useState(true);
        setRunning = update;
        return (
          <CopilotChatMessageView
            messages={[first, second]}
            isRunning={isRunning}
            transformMessages={mergeAssistants}
          />
        );
      }

      renderWithCopilotKit({ children: <Harness /> });

      // Streaming: the latest assistant message hides its toolbar.
      expect(screen.getByText("first half second half")).not.toBeNull();
      expect(screen.queryByTestId("copilot-assistant-toolbar")).toBeNull();

      // The run ends, and the merged message must re-render to show it.
      act(() => setRunning!(false));
      expect(screen.queryByTestId("copilot-assistant-toolbar")).not.toBeNull();
    });

    it("hides the cursor only when the last rendered message is reasoning", () => {
      const reasoning: Message = {
        id: "r-1",
        role: "reasoning",
        content: "thinking",
      } as Message;

      renderWithCopilotKit({
        children: (
          <CopilotChatMessageView
            messages={[...userMessages(1), reasoning]}
            isRunning
            transformMessages={(list) =>
              list.filter((m) => m.role !== "reasoning")
            }
          />
        ),
      });

      // The reasoning card is hidden, so the chat cursor is the only
      // loading indicator left.
      expect(screen.queryByTestId("copilot-loading-cursor")).not.toBeNull();
    });
  });

  it("shows the toolbar on a message that stops being the latest mid-run", () => {
    const first: AssistantMessage = {
      id: "a-1",
      role: "assistant",
      content: "first",
    };
    const second: AssistantMessage = {
      id: "a-2",
      role: "assistant",
      content: "second",
    };

    let setMessages: ((next: Message[]) => void) | null = null;
    function Harness() {
      const [messages, update] = React.useState<Message[]>([first]);
      setMessages = update;
      return <CopilotChatMessageView messages={messages} isRunning />;
    }

    renderWithCopilotKit({ children: <Harness /> });
    expect(screen.queryAllByTestId("copilot-assistant-toolbar")).toHaveLength(
      0,
    );

    // Still running: the new message is the one in progress, the first is done.
    act(() => setMessages!([first, second]));
    expect(screen.queryAllByTestId("copilot-assistant-toolbar")).toHaveLength(
      1,
    );
  });

  it("does not scroll to the bottom when a transform hides the first message", async () => {
    const scrollElement = createScrollElement();
    const messages = userMessages(60);

    let setHideFirst: ((next: boolean) => void) | null = null;
    function Harness() {
      const [hideFirst, update] = React.useState(false);
      setHideFirst = update;
      return (
        <ScrollElementContext.Provider value={scrollElement}>
          <CopilotChatMessageView
            messages={messages}
            transformMessages={hideFirst ? dropFirst : undefined}
          />
        </ScrollElementContext.Provider>
      );
    }

    renderWithCopilotKit({ children: <Harness /> });
    const scrollToIndex = vi.spyOn(capture.current!, "scrollToIndex");

    act(() => setHideFirst!(true));
    expect(virtualizedRowCount()).toBe(59);
    // Same thread, so a reader who scrolled up keeps their place.
    expect(scrollToIndex).not.toHaveBeenCalled();
    await drainAnimationFrames();
  });

  it("keeps a tool card mounted when a transform swaps a stand-in for the durable message", () => {
    // A resumed call the client could not place gets a stand-in assistant
    // message whose id is the tool call id. The durable message with the
    // same call arrives later in the snapshot.
    const toolCall = {
      id: "call-1",
      type: "function" as const,
      function: { name: "getWeather", arguments: '{"location":"Paris"}' },
    };
    const standIn: AssistantMessage = {
      id: "call-1",
      role: "assistant",
      toolCalls: [toolCall],
    };
    const durable: AssistantMessage = {
      id: "a-1",
      role: "assistant",
      content: "",
      toolCalls: [toolCall],
    };
    let setMessages: ((next: Message[]) => void) | null = null;
    function Harness() {
      const [messages, update] = React.useState<Message[]>([
        ...userMessages(1),
        standIn,
      ]);
      setMessages = update;
      return (
        <CopilotChatMessageView
          messages={messages}
          transformMessages={dropStandIns}
        />
      );
    }

    renderWithCopilotKit({
      renderToolCalls: [
        defineToolCallRenderer({
          name: "getWeather",
          args: z.object({ location: z.string() }),
          render: () => <span data-testid="weather-card">card</span>,
        }),
      ],
      children: <Harness />,
    });

    const before = screen.getByTestId("weather-card");
    act(() => setMessages!([...userMessages(1), standIn, durable]));

    const cards = screen.getAllByTestId("weather-card");
    expect(cards).toHaveLength(1);
    // Same DOM node: the row inherited the stand-in's key instead of remounting.
    expect(cards[0]).toBe(before);
  });

  it("warns in development when the transform returns a duplicate id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderWithCopilotKit({
      children: (
        <CopilotChatMessageView
          messages={userMessages(2)}
          transformMessages={(list) => [...list, list[0]!]}
        />
      ),
    });

    expect(
      warn.mock.calls.some(([text]) =>
        String(text).includes('more than one message with id "m-0"'),
      ),
    ).toBe(true);
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
