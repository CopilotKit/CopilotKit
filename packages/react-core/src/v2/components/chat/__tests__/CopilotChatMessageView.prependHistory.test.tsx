import React from "react";
import { act } from "@testing-library/react";
import type { Message } from "@ag-ui/core";
import type { Virtualizer } from "@tanstack/react-virtual";
import type * as ReactVirtual from "@tanstack/react-virtual";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { ScrollElementContext } from "../scroll-element-context";
import {
  createScrollElement,
  drainAnimationFrames,
  userMessages,
} from "../../../__tests__/utils/virtualization";

/**
 * Regression for https://github.com/CopilotKit/CopilotKit/issues/8149:
 * prepending older history changes the first message ID, which the virtualized
 * message view treated as a thread change — it re-aligned to the newest row
 * and reset its measurement cache, so the reader lost their place. The thread
 * did not change, so neither should happen.
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

function virtualizedRowCount(): number {
  if (!capture.current) {
    throw new Error("CopilotChatMessageView did not build a virtualizer");
  }
  return capture.current.options.count;
}

describe("CopilotChatMessageView history prepend", () => {
  it("does not scroll to the bottom when older history is prepended in the same thread", async () => {
    const scrollElement = createScrollElement();
    // The opened thread holds messages 70–149; "load older" prepends 0–69.
    const older = userMessages(70, "m");
    const opened: Message[] = Array.from({ length: 80 }, (_, index) => ({
      id: `m-${index + 70}`,
      role: "user" as const,
      content: `m ${index + 70}`,
    }));

    let prepend: (() => void) | null = null;
    function Harness() {
      const [messages, setMessages] = React.useState<Message[]>(opened);
      prepend = () => setMessages((current) => [...older, ...current]);
      return (
        <ScrollElementContext.Provider value={scrollElement}>
          <CopilotChatMessageView messages={messages} />
        </ScrollElementContext.Provider>
      );
    }

    renderWithCopilotKit({ children: <Harness /> });
    expect(virtualizedRowCount()).toBe(80);

    const scrollToIndex = vi.spyOn(capture.current!, "scrollToIndex");

    act(() => prepend!());
    expect(virtualizedRowCount()).toBe(150);
    // Same thread, so a reader who scrolled up keeps their place.
    expect(scrollToIndex).not.toHaveBeenCalled();
    await drainAnimationFrames();
  });

  it("still scrolls to the bottom when a different thread opens", async () => {
    const scrollElement = createScrollElement();
    const threadA = userMessages(80, "a");
    const threadB = userMessages(80, "b");

    let openB: (() => void) | null = null;
    function Harness() {
      const [threadId, setThreadId] = React.useState("thread-a");
      const [messages, setMessages] = React.useState<Message[]>(threadA);
      openB = () => {
        setThreadId("thread-b");
        setMessages(threadB);
      };
      return (
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <ScrollElementContext.Provider value={scrollElement}>
            <CopilotChatMessageView messages={messages} />
          </ScrollElementContext.Provider>
        </CopilotChatConfigurationProvider>
      );
    }

    renderWithCopilotKit({ children: <Harness /> });
    const scrollToIndex = vi.spyOn(capture.current!, "scrollToIndex");

    act(() => openB!());
    expect(scrollToIndex).toHaveBeenCalledWith(79, { align: "end" });
    await drainAnimationFrames();
  });

  it("aligns to the newest row when the same thread's list is replaced wholesale", async () => {
    // Not a prepend: the previous head is gone, so no row can anchor the
    // reading position (e.g. a refetch replacing every message). Fall back
    // to the thread-change behaviour instead of leaving a stale offset.
    const scrollElement = createScrollElement();
    const opened = userMessages(80, "m");
    const refetched = userMessages(80, "r");

    let replace: (() => void) | null = null;
    function Harness() {
      const [messages, setMessages] = React.useState<Message[]>(opened);
      replace = () => setMessages(refetched);
      return (
        <ScrollElementContext.Provider value={scrollElement}>
          <CopilotChatMessageView messages={messages} />
        </ScrollElementContext.Provider>
      );
    }

    renderWithCopilotKit({ children: <Harness /> });
    expect(virtualizedRowCount()).toBe(80);

    const scrollToIndex = vi.spyOn(capture.current!, "scrollToIndex");
    const measure = vi.spyOn(capture.current!, "measure");

    act(() => replace!());
    expect(scrollToIndex).toHaveBeenCalledWith(79, { align: "end" });
    // Measurements belong to the replaced rows and must not leak across.
    expect(measure).toHaveBeenCalled();
    await drainAnimationFrames();
  });
});
