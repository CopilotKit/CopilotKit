import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { z } from "zod";
import type { Message } from "@ag-ui/core";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import type * as ReactVirtual from "@tanstack/react-virtual";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { defineToolCallRenderer } from "../../../types";
import type { ReactToolCallRenderer } from "../../../types";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { ScrollElementContext } from "../scroll-element-context";

// Pass-through wrapper so the virtualization test can read the real
// virtualizer's options. All other tests are unaffected.
const capture = vi.hoisted(() => ({
  current: null as Virtualizer<HTMLElement, Element> | null,
}));
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactVirtual>();
  return {
    ...actual,
    useVirtualizer: ((options: Parameters<typeof actual.useVirtualizer>[0]) => {
      const instance = actual.useVirtualizer(options);
      capture.current = instance as unknown as Virtualizer<
        HTMLElement,
        Element
      >;
      return instance;
    }) as unknown as typeof actual.useVirtualizer,
  };
});

afterEach(() => {
  cleanup();
  capture.current = null;
});

const hideWorker = (m: Message) =>
  (m as { name?: string }).name !== "math_expert";

// The final MESSAGES_SNAPSHOT from the #1959 repro (langgraph-supervisor
// 0.0.31, ag-ui-langgraph 0.0.45), with the same roles, names and order.
const supervisorTranscript: Message[] = [
  { id: "u1", role: "user", content: "what is 2+2" },
  {
    id: "sup-1",
    role: "assistant",
    name: "supervisor",
    content: "",
    toolCalls: [
      {
        id: "call_handoff",
        type: "function",
        function: { name: "transfer_to_math_expert", arguments: "{}" },
      },
    ],
  },
  {
    id: "tool-1",
    role: "tool",
    toolCallId: "call_handoff",
    content: "Successfully transferred to math_expert",
  },
  {
    id: "w-1",
    role: "assistant",
    name: "math_expert",
    content: "WORKER_SAYS_FOUR",
  },
  {
    id: "w-2",
    role: "assistant",
    name: "math_expert",
    content: "Transferring back to supervisor",
    toolCalls: [
      {
        id: "call_back",
        type: "function",
        function: { name: "transfer_back_to_supervisor", arguments: "{}" },
      },
    ],
  },
  {
    id: "tool-2",
    role: "tool",
    toolCallId: "call_back",
    content: "Successfully transferred back to supervisor",
  },
  {
    id: "sup-2",
    role: "assistant",
    name: "supervisor",
    content: "SUPERVISOR_SAYS_FOUR",
  },
] as Message[];

function renderView(
  props: React.ComponentProps<typeof CopilotChatMessageView>,
  options: {
    renderToolCalls?: ReactToolCallRenderer<unknown>[];
    scrollElement?: HTMLElement;
  } = {},
) {
  const tree = (p: typeof props) => (
    <CopilotKitProvider renderToolCalls={options.renderToolCalls}>
      <CopilotChatConfigurationProvider agentId="default" threadId="thread-srm">
        <ScrollElementContext.Provider value={options.scrollElement ?? null}>
          <CopilotChatMessageView {...p} />
        </ScrollElementContext.Provider>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
  const utils = render(tree(props));
  return {
    ...utils,
    rerenderView: (next: typeof props) => utils.rerender(tree(next)),
  };
}

describe("CopilotChatMessageView shouldRenderMessage", () => {
  it("renders every message when no predicate is given", () => {
    renderView({ messages: supervisorTranscript });
    expect(screen.getByText("WORKER_SAYS_FOUR")).toBeDefined();
    expect(screen.getByText("SUPERVISOR_SAYS_FOUR")).toBeDefined();
  });

  it("hides langgraph-supervisor worker messages by name (#1959)", () => {
    renderView({
      messages: supervisorTranscript,
      shouldRenderMessage: hideWorker,
    });
    expect(screen.queryByText("WORKER_SAYS_FOUR")).toBeNull();
    expect(screen.queryByText("Transferring back to supervisor")).toBeNull();
    expect(screen.getByText("SUPERVISOR_SAYS_FOUR")).toBeDefined();
    expect(screen.getByText("what is 2+2")).toBeDefined();
  });

  it("a visible tool call still finds a hidden tool result", () => {
    const renderToolCalls = [
      defineToolCallRenderer({
        name: "getWeather",
        args: z.object({ city: z.string() }),
        render: ({ result }) => (
          <div data-testid="weather-result">
            {result ? String(result) : "pending"}
          </div>
        ),
      }),
    ] as unknown as ReactToolCallRenderer<unknown>[];
    const messages = [
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc1",
            type: "function",
            function: { name: "getWeather", arguments: '{"city":"Paris"}' },
          },
        ],
      },
      { id: "t1", role: "tool", toolCallId: "tc1", content: "sunny" },
    ] as Message[];
    renderView(
      { messages, shouldRenderMessage: (m) => m.role !== "tool" },
      { renderToolCalls },
    );
    expect(screen.getByTestId("weather-result").textContent).toBe("sunny");
  });

  it("keeps the cursor while running when the last message is hidden", () => {
    renderView({
      messages: supervisorTranscript.slice(0, 4),
      isRunning: true,
      shouldRenderMessage: hideWorker,
    });
    expect(screen.queryByText("WORKER_SAYS_FOUR")).toBeNull();
    expect(screen.getByTestId("copilot-loading-cursor")).toBeDefined();
  });

  it("counts only visible messages for virtualization", async () => {
    // 130 messages, half hidden by name, leaves 65 visible — enough to clear
    // VIRTUALIZE_THRESHOLD (50) on the FILTERED count. Virtualization must
    // activate off the visible count, not the raw 130, so this also proves
    // shouldVirtualize itself reads the filtered list.
    const messages = Array.from({ length: 130 }, (_, i) => ({
      id: `m${i}`,
      role: "assistant",
      content: `row ${i}`,
      name: i % 2 === 0 ? "math_expert" : "supervisor",
    })) as Message[];
    // jsdom reports clientHeight=0 and a zero-size getBoundingClientRect on
    // every element; the component's clientHeight guard and TanStack
    // Virtual's own viewport measurement both need a non-zero size to
    // actually engage the virtualization path (see
    // CopilotChatPerf.e2e.test.tsx's "virtual path" test for the same fix).
    const scrollElement = document.createElement("div");
    Object.defineProperty(scrollElement, "clientHeight", {
      configurable: true,
      value: 600,
    });
    scrollElement.getBoundingClientRect = () =>
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
    renderView(
      { messages, shouldRenderMessage: hideWorker },
      { scrollElement },
    );
    expect(capture.current?.options.count).toBe(65);

    // Drain pending animation frames before the afterEach cleanup unmounts:
    // TanStack Virtual schedules rAF callbacks for measurement, and one
    // firing after jsdom tears down (window === null) throws a spurious
    // uncaught exception.
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
  });

  it("renders an empty list when every message is hidden", () => {
    renderView({
      messages: supervisorTranscript,
      shouldRenderMessage: () => false,
    });
    const list = screen.getByTestId("copilot-message-list");
    expect(list.querySelectorAll("[data-message-id]").length).toBe(0);
  });

  it("keeps row DOM nodes when the predicate identity changes", () => {
    const { rerenderView } = renderView({
      messages: supervisorTranscript,
      shouldRenderMessage: (m) => hideWorker(m),
    });
    const before = document.querySelector('[data-message-id="sup-2"]');
    rerenderView({
      messages: supervisorTranscript,
      shouldRenderMessage: (m) => hideWorker(m),
    });
    expect(document.querySelector('[data-message-id="sup-2"]')).toBe(before);
  });

  it("shows a row again when the predicate stops hiding it", () => {
    const { rerenderView } = renderView({
      messages: supervisorTranscript,
      shouldRenderMessage: hideWorker,
    });
    expect(screen.queryByText("WORKER_SAYS_FOUR")).toBeNull();
    rerenderView({
      messages: supervisorTranscript,
      shouldRenderMessage: () => true,
    });
    expect(screen.getByText("WORKER_SAYS_FOUR")).toBeDefined();
  });

  it("filters after dedupe merges a later named duplicate", () => {
    const messages = [
      { id: "w-1", role: "assistant", content: "WORKER_SAYS_FOUR" },
      {
        id: "w-1",
        role: "assistant",
        name: "math_expert",
        content: "WORKER_SAYS_FOUR",
      },
    ] as Message[];
    renderView({ messages, shouldRenderMessage: hideWorker });
    expect(screen.queryByText("WORKER_SAYS_FOUR")).toBeNull();
  });

  it("children render prop gets filtered elements and the full message list", () => {
    const seen = { messages: -1 };
    renderView({
      messages: supervisorTranscript,
      shouldRenderMessage: hideWorker,
      children: ({ messageElements, messages }) => {
        seen.messages = messages.length;
        return <div>{messageElements}</div>;
      },
    });
    expect(screen.queryByText("WORKER_SAYS_FOUR")).toBeNull();
    expect(seen.messages).toBe(supervisorTranscript.length);
    expect(screen.getByText("SUPERVISOR_SAYS_FOUR")).toBeDefined();
  });
});

describe("CopilotChatMessageView shouldRenderMessage (virtual mode)", () => {
  const TALL = 300;
  const SHORT = 50;
  let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    originalRect = HTMLElement.prototype.getBoundingClientRect;
    // jsdom has no layout. A virtual row (it carries `data-index`) reports
    // TALL when it holds message m2 and SHORT otherwise. Every other element,
    // including the scroll element, reports a 600 px viewport.
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const isRow = this.dataset?.index !== undefined;
      const height = isRow
        ? this.querySelector('[data-message-id="m2"]')
          ? TALL
          : SHORT
        : 600;
      return {
        height,
        width: 800,
        top: 0,
        left: 0,
        bottom: height,
        right: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  // `getMeasurements` is private on the Virtualizer type, but it is the
  // per-row size list this test is about.
  const measurements = () =>
    (
      capture.current as unknown as { getMeasurements(): VirtualItem[] }
    ).getMeasurements();

  const nextFrame = () =>
    act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });

  it("a mid-list hide does not leave later rows in the hidden row's size slot", async () => {
    const scrollElement = document.createElement("div");
    for (const prop of ["clientHeight", "offsetHeight"]) {
      Object.defineProperty(scrollElement, prop, {
        configurable: true,
        value: 600,
      });
    }
    Object.defineProperty(scrollElement, "offsetWidth", {
      configurable: true,
      value: 800,
    });
    document.body.appendChild(scrollElement);

    // 60 visible rows (above VIRTUALIZE_THRESHOLD). m2 is the tall one. When
    // `named` is true, m2 gains `name: "math_expert"`, as a snapshot would
    // add it, and the predicate hides it.
    const transcript = (named: boolean) =>
      Array.from({ length: 60 }, (_, i) => ({
        id: `m${i}`,
        role: "assistant",
        content: i === 2 ? "TALL_ROW" : `row ${i}`,
        ...(i === 2 && named ? { name: "math_expert" } : {}),
      })) as Message[];

    try {
      const { rerenderView } = renderView(
        { messages: transcript(false), shouldRenderMessage: hideWorker },
        { scrollElement },
      );
      await nextFrame();
      const before = measurements();
      expect(before[2]!.size).toBe(TALL);
      expect(before[3]!.size).toBe(SHORT);

      rerenderView({
        messages: transcript(true),
        shouldRenderMessage: hideWorker,
      });
      await nextFrame();

      expect(capture.current!.options.count).toBe(59);
      expect(screen.queryByText("TALL_ROW")).toBeNull();
      // m3 now sits at index 2. Its DOM node was kept and its own size did
      // not change, so nothing re-measures it. Index 2 must hold m3's size,
      // not the size m2 left behind.
      const after = measurements();
      expect(after[2]!.size).toBe(SHORT);
      expect(after.every((m) => m.size !== TALL)).toBe(true);
    } finally {
      scrollElement.remove();
    }
  });

  it("hiding the first message is not a thread change", async () => {
    const scrollElement = document.createElement("div");
    Object.defineProperty(scrollElement, "clientHeight", {
      configurable: true,
      value: 600,
    });
    document.body.appendChild(scrollElement);
    const messages = Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      role: "assistant",
      content: `row ${i}`,
    })) as Message[];

    try {
      const { rerenderView } = renderView(
        { messages, shouldRenderMessage: () => true },
        { scrollElement },
      );
      await nextFrame();
      // A thread change scrolls the list to the end. Hiding m0 changes the
      // first VISIBLE id but not the thread, so it must not scroll.
      const scrollToIndex = vi.spyOn(capture.current!, "scrollToIndex");
      rerenderView({ messages, shouldRenderMessage: (m) => m.id !== "m0" });
      await nextFrame();
      expect(capture.current!.options.count).toBe(59);
      expect(scrollToIndex).not.toHaveBeenCalled();
    } finally {
      scrollElement.remove();
    }
  });
});
