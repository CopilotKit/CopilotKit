import React from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { Message } from "@ag-ui/core";
import type { Virtualizer } from "@tanstack/react-virtual";
import type * as ReactVirtual from "@tanstack/react-virtual";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import {
  createScrollElement,
  drainAnimationFrames,
  userMessages,
} from "../../../__tests__/utils/virtualization";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import {
  CopilotChatMessageView,
  messageGroup,
  messageRow,
} from "../CopilotChatMessageView";
import type {
  MessageGroupWrapperProps,
  MessageRow,
} from "../CopilotChatMessageView";
import { ScrollElementContext } from "../scroll-element-context";

/**
 * `groupMessages` turns the rendered list into rows: a single message, or a
 * group of messages rendered inside the app's own wrapper. A group is one
 * virtualized row, and its wrapper gets a piece of state the view holds for
 * it, so the state outlives the row leaving the window.
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

/** A collapsible shell that keeps its open flag in the view-held state. */
function Collapsible({
  groupKey,
  messages,
  children,
  state,
  setState,
}: MessageGroupWrapperProps<boolean>) {
  const open = state ?? false;
  return (
    <section data-testid={`group-${groupKey}`} data-size={messages.length}>
      <button onClick={() => setState(!open)}>toggle {groupKey}</button>
      {open ? children : null}
    </section>
  );
}

/** Same shell under a different component identity, so React remounts it. */
function CollapsibleAgain(props: MessageGroupWrapperProps<boolean>) {
  return <Collapsible {...props} />;
}

/** Groups every message whose id starts with `prefix` into one row. */
function groupByPrefix(
  prefix: string,
  wrapper: React.ComponentType<MessageGroupWrapperProps<boolean>> = Collapsible,
) {
  return (list: Message[]): MessageRow[] => {
    const grouped = list.filter((m) => m.id.startsWith(prefix));
    const rows: MessageRow[] = [];
    let placed = false;
    for (const message of list) {
      if (!message.id.startsWith(prefix)) {
        rows.push(messageRow(message));
      } else if (!placed) {
        rows.push(messageGroup({ key: prefix, messages: grouped, wrapper }));
        placed = true;
      }
    }
    return rows;
  };
}

afterEach(() => {
  cleanup();
  capture.current = null;
  vi.restoreAllMocks();
});

describe("CopilotChatMessageView groupMessages", () => {
  it("renders a group's messages inside its wrapper, with ungrouped messages as they were", () => {
    renderWithCopilotKit({
      children: (
        <CopilotChatMessageView
          messages={[...userMessages(2, "a"), ...userMessages(3, "tool")]}
          groupMessages={groupByPrefix("tool")}
        />
      ),
    });

    const group = screen.getByTestId("group-tool");
    expect(group.dataset.size).toBe("3");
    expect(screen.queryByText("a 0")).not.toBeNull();
    // Collapsed: the wrapper decides whether the default rendering shows.
    expect(screen.queryByText("tool 0")).toBeNull();

    fireEvent.click(screen.getByText("toggle tool"));
    expect(group.textContent).toContain("tool 0");
    expect(group.textContent).toContain("tool 2");
  });

  it("receives the transformed list", () => {
    const received: string[][] = [];

    renderWithCopilotKit({
      children: (
        <CopilotChatMessageView
          messages={userMessages(3)}
          transformMessages={(list) => list.slice(1)}
          groupMessages={(list) => {
            received.push(list.map((m) => m.id));
            return list.map(messageRow);
          }}
        />
      ),
    });

    expect(received.at(-1)).toEqual(["m-1", "m-2"]);
  });

  it("counts a group as one virtualized row", async () => {
    renderWithCopilotKit({
      children: (
        <ScrollElementContext.Provider value={createScrollElement()}>
          <CopilotChatMessageView
            messages={[...userMessages(60, "a"), ...userMessages(20, "tool")]}
            groupMessages={groupByPrefix("tool")}
          />
        </ScrollElementContext.Provider>
      ),
    });

    expect(virtualizedRowCount()).toBe(61);
    await drainAnimationFrames();
  });

  it("keeps a long thread virtualized however few rows it folds into", async () => {
    // 60 messages, 2 rows: the threshold is about how much a thread mounts,
    // and an expanded group mounts all of its messages.
    renderWithCopilotKit({
      children: (
        <ScrollElementContext.Provider value={createScrollElement()}>
          <CopilotChatMessageView
            messages={[...userMessages(1, "a"), ...userMessages(59, "tool")]}
            groupMessages={groupByPrefix("tool")}
          />
        </ScrollElementContext.Provider>
      ),
    });

    expect(virtualizedRowCount()).toBe(2);
    await drainAnimationFrames();
  });

  describe("group state", () => {
    let setGrouping:
      | ((grouping: (list: Message[]) => MessageRow[]) => void)
      | null = null;

    function Harness({
      initial,
    }: {
      initial: (list: Message[]) => MessageRow[];
    }) {
      const [grouping, update] = React.useState(() => initial);
      setGrouping = (next) => update(() => next);
      return (
        <CopilotChatMessageView
          messages={[...userMessages(1, "a"), ...userMessages(2, "tool")]}
          groupMessages={grouping}
        />
      );
    }

    afterEach(() => {
      setGrouping = null;
    });

    it("outlives the wrapper being unmounted", () => {
      renderWithCopilotKit({
        children: <Harness initial={groupByPrefix("tool")} />,
      });
      fireEvent.click(screen.getByText("toggle tool"));
      expect(screen.queryByText("tool 0")).not.toBeNull();

      // A different wrapper component for the same key: React throws the old
      // wrapper away, exactly as windowing does when the row scrolls off.
      act(() => setGrouping!(groupByPrefix("tool", CollapsibleAgain)));

      expect(screen.queryByText("tool 0")).not.toBeNull();
    });

    it("is dropped when its key stops appearing", () => {
      renderWithCopilotKit({
        children: <Harness initial={groupByPrefix("tool")} />,
      });
      fireEvent.click(screen.getByText("toggle tool"));

      act(() => setGrouping!((list) => list.map(messageRow)));
      act(() => setGrouping!(groupByPrefix("tool")));

      expect(screen.queryByText("tool 0")).toBeNull();
    });

    it("is cleared when the thread changes", () => {
      let setThreadId: ((id: string) => void) | null = null;
      function ThreadHarness() {
        const [threadId, update] = React.useState("thread-1");
        setThreadId = update;
        return (
          <CopilotChatConfigurationProvider
            agentId="default"
            threadId={threadId}
          >
            <CopilotChatMessageView
              messages={[...userMessages(1, "a"), ...userMessages(2, "tool")]}
              groupMessages={groupByPrefix("tool")}
            />
          </CopilotChatConfigurationProvider>
        );
      }

      renderWithCopilotKit({ children: <ThreadHarness /> });
      fireEvent.click(screen.getByText("toggle tool"));
      expect(screen.queryByText("tool 0")).not.toBeNull();

      act(() => setThreadId!("thread-2"));

      expect(screen.queryByText("tool 0")).toBeNull();
    });
  });

  describe("development warnings", () => {
    it("warns when two groups share a key", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      renderWithCopilotKit({
        children: (
          <CopilotChatMessageView
            messages={userMessages(2)}
            groupMessages={(list) =>
              list.map((m) =>
                messageGroup({
                  key: "same",
                  messages: [m],
                  wrapper: Collapsible,
                }),
              )
            }
          />
        ),
      });

      expect(
        warn.mock.calls.some(([text]) => String(text).includes('key "same"')),
      ).toBe(true);
    });

    it("warns when a message lands in two rows", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      renderWithCopilotKit({
        children: (
          <CopilotChatMessageView
            messages={userMessages(2)}
            groupMessages={(list) => [
              ...list.map(messageRow),
              messageGroup({
                key: "all",
                messages: list,
                wrapper: Collapsible,
              }),
            ]}
          />
        ),
      });

      expect(
        warn.mock.calls.some(([text]) => String(text).includes('"m-0"')),
      ).toBe(true);
    });
  });
});
