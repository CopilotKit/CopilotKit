import React from "react";
import { act, cleanup } from "@testing-library/react";
import type { Message } from "@ag-ui/core";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import type * as ReactVirtual from "@tanstack/react-virtual";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import {
  CopilotChatMessageView,
  messageGroup,
  messageRow,
} from "../CopilotChatMessageView";
import { ScrollPinnedContext } from "../scroll-pinned-context";
import { ScrollElementContext } from "../scroll-element-context";

/**
 * Covers the two things CopilotChatMessageView configures on its virtualizer
 * to keep it from fighting the pin-to-bottom behaviour:
 *
 *   - `shouldAdjustScrollPositionOnItemSizeChange`, which decides whether a
 *     row changing size is allowed to move the scroll position.
 *   - `estimateSize` / `measureElement`, the running mean that keeps the
 *     total size from lurching when an unmeasured row turns out to be a code
 *     block rather than a sentence.
 *
 * Both are exercised through the real virtualizer instance the component
 * builds, so the assertions fail if the wiring is dropped as well as if the
 * logic is wrong. jsdom reports every height as 0, so the sizes are fed in
 * directly rather than rendered.
 */

type CapturedVirtualizer = Virtualizer<HTMLElement, Element>;

const capture = vi.hoisted(() => ({
  current: null as CapturedVirtualizer | null,
}));

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactVirtual>();
  return {
    ...actual,
    // The real hook still runs — this only keeps a reference to its result,
    // so hook order and virtualizer behaviour are untouched. One cast at the
    // mock boundary, because the wrapper cannot restate the hook's generics.
    useVirtualizer: ((options: Parameters<typeof actual.useVirtualizer>[0]) => {
      const instance = actual.useVirtualizer(options);
      capture.current = instance as unknown as CapturedVirtualizer;
      return instance;
    }) as unknown as typeof actual.useVirtualizer,
  };
});

function virtualizer(): CapturedVirtualizer {
  if (!capture.current) {
    throw new Error("CopilotChatMessageView did not build a virtualizer");
  }
  return capture.current;
}

/** A row starting at `start` px into the list. */
function itemAt(start: number): VirtualItem {
  return { index: 0, key: 0, start, end: start + 100, size: 100, lane: 0 };
}

/** Just the fields the predicate reads off the virtualizer. */
function scrolledTo(
  scrollOffset: number,
  scrollAdjustments = 0,
): CapturedVirtualizer {
  return { scrollOffset, scrollAdjustments } as unknown as CapturedVirtualizer;
}

/** A measured row element: `data-index` plus a height. */
function measuredRow(index: number, height: number): Element {
  return {
    dataset: { index: String(index) },
    getBoundingClientRect: () => ({ height }) as DOMRect,
  } as unknown as Element;
}

/** A row element attached to the document, as the virtualizer sees it on screen. */
function attachedRow(index: number, height: number): Element {
  return {
    isConnected: true,
    dataset: { index: String(index) },
    getBoundingClientRect: () => ({ height }) as DOMRect,
  } as unknown as Element;
}

/** The fields measureElement reads off the virtualizer, for a list `height` px tall. */
function listOfHeight(height: number): CapturedVirtualizer {
  return {
    scrollElement: { clientHeight: height },
    options: { count: 2 },
  } as unknown as CapturedVirtualizer;
}

/** The y offset of an element's `translateY(...)` transform, or 0. */
const translateY = (element: HTMLElement | null | undefined) =>
  Number(
    /translateY\((-?[\d.]+)px\)/.exec(element?.style.transform ?? "")?.[1] ?? 0,
  );

function message(id: string): Message {
  return { id, role: "user", content: id } as Message;
}

let setMessages: ((messages: Message[]) => void) | null = null;

/** Wraps the "history" group row in the long-thread tests. */
function HistoryWrapper({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

type GroupMessages = React.ComponentProps<
  typeof CopilotChatMessageView
>["groupMessages"];

function Harness({
  isPinnedToBottom,
  initialMessages = [],
  groupMessages,
}: {
  isPinnedToBottom: boolean;
  initialMessages?: Message[];
  groupMessages?: GroupMessages;
}) {
  const [messages, updateMessages] = React.useState(initialMessages);
  setMessages = updateMessages;
  return (
    <ScrollPinnedContext.Provider value={isPinnedToBottom}>
      <CopilotChatMessageView
        messages={messages}
        groupMessages={groupMessages}
      />
    </ScrollPinnedContext.Provider>
  );
}

function renderMessageView(options: {
  isPinnedToBottom: boolean;
  initialMessages?: Message[];
  groupMessages?: GroupMessages;
}) {
  renderWithCopilotKit({ children: <Harness {...options} /> });
}

afterEach(() => {
  cleanup();
  capture.current = null;
  setMessages = null;
});

describe("CopilotChatMessageView virtual-scroll tuning", () => {
  describe("shouldAdjustScrollPositionOnItemSizeChange", () => {
    it("is wired to the virtualizer", () => {
      renderMessageView({ isPinnedToBottom: false });
      expect(
        virtualizer().shouldAdjustScrollPositionOnItemSizeChange,
      ).toBeTypeOf("function");
    });

    it("never moves the scroll position while the pin owns it", () => {
      renderMessageView({ isPinnedToBottom: true });
      const shouldAdjust =
        virtualizer().shouldAdjustScrollPositionOnItemSizeChange!;

      // Above the viewport — the one case compensation exists for — and still
      // declined, because the pin is about to set the scroll position anyway.
      expect(shouldAdjust(itemAt(100), 40, scrolledTo(800))).toBe(false);
      expect(shouldAdjust(itemAt(1200), 40, scrolledTo(800))).toBe(false);
    });

    it("compensates only for rows above the scroll offset when unpinned", () => {
      renderMessageView({ isPinnedToBottom: false });
      const shouldAdjust =
        virtualizer().shouldAdjustScrollPositionOnItemSizeChange!;

      // A row above the viewport growing would push what the reader is
      // looking at down the screen, so the offset moves to cancel it out.
      expect(shouldAdjust(itemAt(100), 40, scrolledTo(800))).toBe(true);
      // A row below the viewport — an overscanned row settling, say — changes
      // nothing the reader can see. Moving the scroll position for it is the
      // unwanted motion this whole thing is meant to remove.
      expect(shouldAdjust(itemAt(1200), 40, scrolledTo(800))).toBe(false);
      // Corrections already applied count towards where the viewport is.
      expect(shouldAdjust(itemAt(900), 40, scrolledTo(800, 150))).toBe(true);
    });
  });

  describe("container width changes", () => {
    it.each([false, true])(
      "invalidates offscreen heights and preserves the reading row (rows measured first: %s)",
      async (rowsFirst) => {
        const callbacks = new Map<Element, Set<ResizeObserverCallback>>();
        const originalObserver = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class {
          callback: ResizeObserverCallback;
          targets = new Set<Element>();
          constructor(callback: ResizeObserverCallback) {
            this.callback = callback;
          }
          observe(target: Element) {
            this.targets.add(target);
            const listeners = callbacks.get(target) ?? new Set();
            listeners.add(this.callback);
            callbacks.set(target, listeners);
          }
          unobserve(target: Element) {
            callbacks.get(target)?.delete(this.callback);
          }
          disconnect() {
            for (const target of this.targets) this.unobserve(target);
          }
        } as typeof ResizeObserver;
        let width = 600;
        const createContainer = () => {
          const element = document.createElement("div");
          Object.defineProperties(element, {
            clientWidth: { get: () => width },
            clientHeight: { value: 600 },
            scrollHeight: { get: () => virtualizer().getTotalSize() },
          });
          element.getBoundingClientRect = () =>
            ({ width, height: 600 }) as DOMRect;
          element.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
            element.scrollTop = top ?? 0;
            element.dispatchEvent(new Event("scroll"));
          }) as typeof element.scrollTo;
          return element;
        };
        const container = createContainer();
        const messages: Message[] = Array.from({ length: 100 }, (_, index) => ({
          id: String(index),
          role: "user",
          content: "word ".repeat(200),
        }));
        let replaceContainer: (element: HTMLDivElement) => void;
        function ScrollContainerHarness() {
          const [element, setElement] = React.useState(container);
          replaceContainer = setElement;
          return (
            <ScrollElementContext.Provider value={element}>
              <Harness isPinnedToBottom={false} initialMessages={messages} />
            </ScrollElementContext.Provider>
          );
        }
        const rect = vi
          .spyOn(HTMLElement.prototype, "getBoundingClientRect")
          .mockImplementation(function (this: HTMLElement) {
            return {
              width,
              height: this.hasAttribute("data-index")
                ? width < 400
                  ? 600
                  : 300
                : 0,
            } as DOMRect;
          });
        let nextFrame = 0;
        const frames = new Map<number, FrameRequestCallback>();
        const frame = vi
          .spyOn(window, "requestAnimationFrame")
          .mockImplementation((callback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
          });
        const cancelFrame = vi
          .spyOn(window, "cancelAnimationFrame")
          .mockImplementation((id) => {
            frames.delete(id);
          });
        try {
          renderWithCopilotKit({
            children: <ScrollContainerHarness />,
          });
          act(() => {
            // Row 0 is far above the reader; its measurement must also expire.
            virtualizer().resizeItem(0, 900);
            virtualizer().options.measureElement(
              measuredRow(0, 900),
              undefined,
              virtualizer(),
            );
          });
          act(() => {
            const row = virtualizer().measurementsCache[50];
            container.scrollTop = row.start + 25;
            container.dispatchEvent(new Event("scroll"));
          });
          // Let the rows newly brought into view settle before resizing.
          act(() => {
            container.scrollTop =
              virtualizer().measurementsCache[50].start + 25;
            container.dispatchEvent(new Event("scroll"));
          });
          expect(
            virtualizer().getVirtualItemForOffset(container.scrollTop)?.index,
          ).toBe(50);
          const resize = (nextWidth: number) =>
            act(() => {
              width = nextWidth;
              if (rowsFirst) {
                for (const row of document.querySelectorAll("[data-index]")) {
                  virtualizer().measureElement(row);
                }
              }
              for (const callback of callbacks.get(container) ?? []) {
                callback(
                  [
                    {
                      target: container,
                      borderBoxSize: [{ inlineSize: width, blockSize: 600 }],
                    },
                  ] as unknown as ResizeObserverEntry[],
                  {} as ResizeObserver,
                );
              }
            });
          const flushFrame = () =>
            act(() => {
              const pending = [...frames.values()];
              frames.clear();
              pending.forEach((callback) => callback(0));
            });
          resize(300);
          flushFrame();
          expect(virtualizer().measurementsCache[0].size).toBe(600);
          expect(
            container.scrollTop - virtualizer().measurementsCache[50].start,
          ).toBe(25);
          expect(virtualizer().options.estimateSize(0)).toBe(600);
          const total = virtualizer().getTotalSize();
          resize(300);
          expect(virtualizer().getTotalSize()).toBe(total);
          resize(600);
          flushFrame();
          expect(virtualizer().measurementsCache[0].size).toBe(300);
          expect(virtualizer().options.estimateSize(0)).toBe(300);
          expect(
            container.scrollTop - virtualizer().measurementsCache[50].start,
          ).toBe(25);
          // Replace the viewport after remeasurement, before the next frame
          // releases the old reading anchor.
          const replacement = createContainer();
          act(() => replaceContainer(replacement));
          expect(callbacks.get(container)?.size).toBe(0);
          expect(
            virtualizer().shouldAdjustScrollPositionOnItemSizeChange!(
              itemAt(100),
              40,
              scrolledTo(800),
            ),
          ).toBe(true);
        } finally {
          // TanStack's scroll-end debounce can notify after its listener is removed.
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 180));
          });
          cleanup();
          rect.mockRestore();
          frame.mockRestore();
          cancelFrame.mockRestore();
          globalThis.ResizeObserver = originalObserver;
        }
      },
    );
  });

  describe("rangeExtractor", () => {
    /** Rows of the given heights, laid out from the top of the list. */
    function rowsOf(heights: number[]): VirtualItem[] {
      let start = 0;
      return heights.map((size, index) => {
        const item = {
          index,
          key: index,
          start,
          end: start + size,
          size,
          lane: 0,
        };
        start += size;
        return item;
      });
    }

    function renderRange(heights: number[], visible: [number, number]) {
      renderMessageView({ isPinnedToBottom: false });
      const instance = virtualizer();
      Object.assign(instance, {
        measurementsCache: rowsOf(heights),
        scrollRect: { width: 800, height: 600 },
      });
      const indexes = instance.options.rangeExtractor({
        startIndex: visible[0],
        endIndex: visible[1],
        overscan: 5,
        count: heights.length,
      });
      return { first: indexes[0], last: indexes.at(-1) };
    }

    it("keeps the five-row overscan when rows have content", () => {
      // 600 px of 100 px rows is six rows, so six beyond the viewport.
      const { first, last } = renderRange(Array(200).fill(100), [100, 109]);
      expect(first).toBe(94);
      expect(last).toBe(115);
    });

    it("reaches a viewport's height past rows that render nothing", () => {
      // Rows 50–99 are tool calls and results that render nothing. Five rows
      // of overscan would stop at row 95, 0 px above the viewport, and row 49
      // would first be measured in view.
      const heights = [
        ...Array(50).fill(100),
        ...Array(50).fill(0),
        ...Array(10).fill(100),
      ];
      const { first } = renderRange(heights, [100, 109]);
      expect(first).toBe(44);
    });

    it("stops after a bounded number of rows", () => {
      const { first } = renderRange(Array(1000).fill(0), [900, 909]);
      expect(first).toBe(500);
    });
  });

  describe("row identity", () => {
    it("keys the virtualizer by row, so an inserted row does not shift the rest", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("a"), message("b")],
      });
      expect(virtualizer().options.getItemKey(0)).toBe("copilotkit-message:a");

      act(() => {
        setMessages!([message("a"), message("inserted"), message("b")]);
      });

      // Keyed by index, row 2 would inherit whatever was measured for index
      // 2 before, and "b" would take the height cached for index 1.
      expect(virtualizer().options.getItemKey(1)).toBe(
        "copilotkit-message:inserted",
      );
      expect(virtualizer().options.getItemKey(2)).toBe("copilotkit-message:b");
    });

    it("keeps the same key function when a re-render rebuilds the same rows", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("a"), message("b")],
      });
      const getItemKey = virtualizer().options.getItemKey;

      // A new key function makes the virtualizer re-estimate every unmeasured
      // row above the viewport, which moves a reader who scrolled up.
      act(() => {
        setMessages!([message("a"), message("b")]);
      });

      expect(virtualizer().options.getItemKey).toBe(getItemKey);
    });

    it("keeps a row's measured height with the row when rows shift", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("a"), message("b")],
      });
      const measure = (index: number, height: number) =>
        virtualizer().options.measureElement(
          measuredRow(index, height),
          undefined,
          virtualizer(),
        );
      measure(0, 300);
      measure(1, 100);
      expect(virtualizer().options.estimateSize(2)).toBe(200);

      act(() => {
        setMessages!([message("a"), message("inserted"), message("b")]);
      });
      // "b" re-reports from its new index at the same height.
      measure(2, 100);

      // Still two rows at 300 and 100. Keyed by index, index 2 would count
      // as a third row: mean(300, 100, 100) = 167.
      expect(virtualizer().options.estimateSize(3)).toBe(200);
    });

    it("never gives a message the key of a group, whatever its id", () => {
      const Wrapper = ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
      );
      const groupMessages: GroupMessages = (list) => [
        messageGroup({
          key: "tool-1",
          messages: list.filter((m) => m.id === "tool-1"),
          wrapper: Wrapper,
        }),
        ...list.filter((m) => m.id !== "tool-1").map(messageRow),
      ];
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [
          message("tool-1"),
          message("copilotkit-group:tool-1"),
        ],
        groupMessages,
      });

      const { getItemKey } = virtualizer().options;
      expect(getItemKey(0)).not.toBe(getItemKey(1));
    });

    it("keeps rows after a group on their own keys as the group absorbs messages", () => {
      // Folds every message whose id starts with "tool-" into one row.
      const Wrapper = ({ children }: { children: React.ReactNode }) => (
        <div>{children}</div>
      );
      const groupMessages: GroupMessages = (list) => {
        const tools = list.filter((m) => m.id.startsWith("tool-"));
        const rest = list.filter((m) => !m.id.startsWith("tool-"));
        return [
          ...(tools.length > 0
            ? [
                messageGroup({
                  key: tools[0]!.id,
                  messages: tools,
                  wrapper: Wrapper,
                }),
              ]
            : []),
          ...rest.map(messageRow),
        ];
      };
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("tool-1"), message("answer")],
        groupMessages,
      });
      const keyOfAnswer = () => {
        const { options } = virtualizer();
        for (let i = 0; i < 4; i++) {
          if (options.getItemKey(i) === "copilotkit-message:answer") return i;
        }
        return -1;
      };
      expect(keyOfAnswer()).toBe(1);

      // A second tool call streams in. It joins the group, so the row count
      // and the answer's index stay put, and the group keeps its key.
      act(() => {
        setMessages!([message("tool-1"), message("tool-2"), message("answer")]);
      });
      expect(virtualizer().options.getItemKey(0)).toBe(
        "copilotkit-group:tool-1",
      );
      expect(keyOfAnswer()).toBe(1);
    });

    it("forgets rows that leave the list", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("a"), message("b"), message("c")],
      });
      const { options } = virtualizer();
      options.measureElement(measuredRow(0, 300), undefined, virtualizer());
      options.measureElement(measuredRow(1, 100), undefined, virtualizer());
      options.measureElement(measuredRow(2, 500), undefined, virtualizer());

      act(() => {
        setMessages!([message("a"), message("c")]);
      });

      expect(virtualizer().options.estimateSize(2)).toBe(400);
    });
  });

  describe("estimateSize", () => {
    it("falls back to a flat estimate before anything is measured", () => {
      renderMessageView({ isPinnedToBottom: false });
      expect(virtualizer().options.estimateSize(0)).toBe(100);
    });

    it("counts a row once however often it is re-measured", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("a"), message("b"), message("c")],
      });
      const { options } = virtualizer();

      // Row 0 is streaming: the ResizeObserver reports it repeatedly as it
      // grows. Only its current height should count.
      options.measureElement(measuredRow(0, 40), undefined, virtualizer());
      options.measureElement(measuredRow(0, 220), undefined, virtualizer());
      options.measureElement(measuredRow(0, 400), undefined, virtualizer());
      options.measureElement(measuredRow(1, 200), undefined, virtualizer());

      // Mean of {400, 200}. Treating every report as its own sample would
      // give mean({40, 220, 400, 200}) = 215.
      expect(options.estimateSize(2)).toBe(300);
    });

    it("ignores rows that report no height while the list is hidden", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("a"), message("b"), message("c")],
      });
      const { options } = virtualizer();

      options.measureElement(measuredRow(0, 300), undefined, virtualizer());
      options.measureElement(measuredRow(1, 0), undefined, virtualizer());

      expect(options.estimateSize(2)).toBe(300);
    });

    it("measures a row that renders nothing as 0 in a visible list", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("a"), message("b"), message("c")],
      });
      const { options } = virtualizer();

      // An assistant turn holding only tool calls without a renderer, or its
      // tool result, renders nothing. It must not take the 100 px estimate:
      // thousands of them left long blank stretches in a tool-heavy thread.
      options.measureElement(attachedRow(0, 300), undefined, listOfHeight(600));
      expect(
        options.measureElement(attachedRow(1, 0), undefined, listOfHeight(600)),
      ).toBe(0);

      // And it counts toward the estimate for rows not yet measured.
      expect(options.estimateSize(2)).toBe(150);
    });

    it("keeps a row's last height while the list is hidden", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("a"), message("b"), message("c")],
      });
      const { options } = virtualizer();

      options.measureElement(attachedRow(0, 300), undefined, listOfHeight(600));
      // In a display:none tab every row measures 0; that says nothing about
      // its size.
      expect(
        options.measureElement(attachedRow(0, 0), undefined, listOfHeight(0)),
      ).toBe(300);
      expect(
        options.measureElement(attachedRow(1, 0), undefined, listOfHeight(0)),
      ).toBe(100);
      expect(options.estimateSize(2)).toBe(300);
    });

    it("drops the measurements when the thread changes", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("thread-a-first"), message("a-2")],
      });
      virtualizer().options.measureElement(
        measuredRow(0, 300),
        undefined,
        virtualizer(),
      );
      expect(virtualizer().options.estimateSize(1)).toBe(300);

      act(() => {
        setMessages!([message("thread-b-first"), message("b-2")]);
      });

      // A different thread's rows say nothing about this one's.
      expect(virtualizer().options.estimateSize(1)).toBe(100);
    });

    it("keeps the measurements while the same thread grows", () => {
      renderMessageView({
        isPinnedToBottom: false,
        initialMessages: [message("thread-a-first")],
      });
      virtualizer().options.measureElement(
        measuredRow(0, 300),
        undefined,
        virtualizer(),
      );

      act(() => {
        setMessages!([message("thread-a-first"), message("a-2")]);
      });

      expect(virtualizer().options.estimateSize(1)).toBe(300);
    });

    describe("rows above the viewport in a long thread", () => {
      // A resumed thread long enough to virtualize, pinned to the bottom. The
      // rows near the bottom are far taller than the ones at the top, so the
      // mean moves a long way once they are measured. Neither height is the
      // flat 100 px fallback, so a row still laid out at the fallback shows.
      const thread = Array.from({ length: 80 }, (_, i) => message(`m-${i}`));
      let container: HTMLDivElement;
      let rect: { mockRestore: () => void };
      let width: number;
      let heightOf: (index: number) => number;

      beforeEach(() => {
        width = 600;
        heightOf = (index) => (index >= 70 ? 1000 : 300);
        container = document.createElement("div");
        Object.defineProperties(container, {
          clientWidth: { get: () => width },
          clientHeight: { value: 600 },
          offsetWidth: { get: () => width },
          offsetHeight: { value: 600 },
          scrollHeight: { get: () => virtualizer().getTotalSize() },
        });
        container.getBoundingClientRect = () =>
          ({ width, height: 600 }) as DOMRect;
        container.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
          container.scrollTop = top ?? 0;
          container.dispatchEvent(new Event("scroll"));
        }) as typeof container.scrollTo;
        rect = vi
          .spyOn(HTMLElement.prototype, "getBoundingClientRect")
          .mockImplementation(function (this: HTMLElement) {
            const index = Number(this.dataset.index);
            return {
              width,
              height: Number.isInteger(index) ? heightOf(index) : 0,
            } as DOMRect;
          });
      });

      afterEach(async () => {
        // TanStack's scroll-end debounce can notify after its listener is removed.
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 180));
        });
        cleanup();
        rect.mockRestore();
      });

      /** Scrolls to the bottom so only the last, tall rows get measured. */
      function settleAtBottom() {
        expect(virtualizer().options.count).toBe(80);
        for (let i = 0; i < 2; i++) {
          act(() => {
            container.scrollTop = virtualizer().getTotalSize() - 600;
            container.dispatchEvent(new Event("scroll"));
          });
        }
        const mounted = virtualizer()
          .getVirtualItems()
          .map((row) => row.index);
        expect(mounted.length).toBeGreaterThan(0);
        expect(Math.min(...mounted)).toBeGreaterThan(40);
        // The tall rows at the bottom moved the mean away from the 300 px rows.
        expect(virtualizer().options.estimateSize(80)).toBeGreaterThan(300);
      }

      /** Where the 40 rows at the top of the thread start. */
      function topRowStarts() {
        // getTotalSize() brings the layout up to date before it is read.
        virtualizer().getTotalSize();
        return virtualizer()
          .measurementsCache.slice(0, 40)
          .map((row) => row.start);
      }

      it("keeps them in place when a message is sent", () => {
        renderWithCopilotKit({
          children: (
            <ScrollElementContext.Provider value={container}>
              <Harness isPinnedToBottom initialMessages={thread} />
            </ScrollElementContext.Provider>
          ),
        });
        settleAtBottom();
        const before = topRowStarts();

        act(() => {
          setMessages!([...thread, message("sent")]);
        });

        // Adding a row rebuilds the layout from the top. Re-estimating the
        // rows above at the new mean would push each of them down by
        // hundreds of pixels — the jump up the history seen after sending.
        expect(virtualizer().options.count).toBe(81);
        expect(topRowStarts()).toEqual(before);
      });

      it("keeps them in place after React discards a render without one of them", () => {
        const never = new Promise<never>(() => {});
        function SuspendsWhile({ pending }: { pending: boolean }) {
          if (pending) throw never;
          return null;
        }
        let update: (messages: Message[], pending: boolean) => void;
        function DiscardingHarness() {
          const [messages, setThread] = React.useState(thread);
          const [pending, setPending] = React.useState(false);
          update = (next, nextPending) => {
            setThread(next);
            setPending(nextPending);
          };
          return (
            <ScrollPinnedContext.Provider value={true}>
              <React.Suspense fallback={null}>
                <CopilotChatMessageView messages={messages} />
                <SuspendsWhile pending={pending} />
              </React.Suspense>
            </ScrollPinnedContext.Provider>
          );
        }
        renderWithCopilotKit({
          children: (
            <ScrollElementContext.Provider value={container}>
              <DiscardingHarness />
            </ScrollElementContext.Provider>
          ),
        });
        settleAtBottom();
        const before = topRowStarts();

        // The message view renders a list without m-30, then a sibling
        // suspends, so React keeps the committed list and throws that render
        // away. A second transition supersedes it.
        act(() => {
          React.startTransition(() => {
            update(
              thread.filter((m) => m.id !== "m-30"),
              true,
            );
          });
        });
        act(() => {
          React.startTransition(() => update(thread, false));
        });

        act(() => {
          update([...thread, message("sent")], false);
        });

        // m-30 never left the committed list, so it keeps its estimate. Had
        // the discarded render dropped it, m-30 would come back at the current
        // mean and push every row below it down.
        expect(virtualizer().options.count).toBe(81);
        expect(topRowStarts()).toEqual(before);
      });

      it("lays the history out at the thread's measured mean, not the flat fallback", () => {
        renderWithCopilotKit({
          children: (
            <ScrollElementContext.Provider value={container}>
              <Harness isPinnedToBottom initialMessages={thread} />
            </ScrollElementContext.Provider>
          ),
        });
        settleAtBottom();

        // Rows 20-39 were never mounted. They were first laid out before
        // anything was measured, at the flat fallback; once the first rows
        // are measured the thread is laid out again from their mean, which
        // here is the true height of every row in the history.
        const history = virtualizer().measurementsCache.slice(20, 40);
        expect(history.map((row) => row.size)).toEqual(
          Array.from({ length: 20 }, () => 300),
        );
      });

      it("keeps the view in place when the width changes while pinned", () => {
        // Every row is 400 px whatever the width, so a width change has
        // nothing to correct. Rows still at the flat fallback would all be
        // re-estimated at once and push the bottom thousands of pixels away.
        heightOf = () => 400;
        const observers = new Map<Element, Set<ResizeObserverCallback>>();
        const OriginalObserver = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class {
          constructor(private callback: ResizeObserverCallback) {}
          observe(target: Element) {
            const callbacks = observers.get(target) ?? new Set();
            callbacks.add(this.callback);
            observers.set(target, callbacks);
          }
          unobserve(target: Element) {
            observers.get(target)?.delete(this.callback);
          }
          disconnect() {
            for (const callbacks of observers.values()) {
              callbacks.delete(this.callback);
            }
          }
        } as unknown as typeof ResizeObserver;
        const frames: FrameRequestCallback[] = [];
        const frame = vi
          .spyOn(window, "requestAnimationFrame")
          .mockImplementation((callback) => frames.push(callback));
        const flushFrames = () =>
          act(() => {
            for (const callback of frames.splice(0)) callback(0);
          });
        try {
          renderWithCopilotKit({
            children: (
              <ScrollElementContext.Provider value={container}>
                <Harness isPinnedToBottom initialMessages={thread} />
              </ScrollElementContext.Provider>
            ),
          });
          for (let i = 0; i < 2; i++) {
            act(() => {
              container.scrollTop = virtualizer().getTotalSize() - 600;
              container.dispatchEvent(new Event("scroll"));
            });
          }
          flushFrames();
          expect(virtualizer().getTotalSize()).toBe(80 * 400);
          const fromBottom = () =>
            virtualizer().getTotalSize() - container.scrollTop - 600;
          const before = fromBottom();

          act(() => {
            width = 590;
            for (const callback of observers.get(container) ?? []) {
              callback(
                [
                  {
                    target: container,
                    borderBoxSize: [{ inlineSize: width, blockSize: 600 }],
                  },
                ] as unknown as ResizeObserverEntry[],
                {} as ResizeObserver,
              );
            }
          });
          flushFrames();

          expect(virtualizer().getTotalSize()).toBe(80 * 400);
          expect(fromBottom()).toBe(before);
        } finally {
          frame.mockRestore();
          globalThis.ResizeObserver = OriginalObserver;
        }
      });

      it("keeps tracking the new thread's rows after switching between long threads", () => {
        renderWithCopilotKit({
          children: (
            <ScrollElementContext.Provider value={container}>
              <Harness isPinnedToBottom initialMessages={thread} />
            </ScrollElementContext.Provider>
          ),
        });
        settleAtBottom();

        // Another long thread, shown while the view sits at the bottom. The
        // old thread's rows unmount as the new thread's mount at the same
        // indexes.
        const otherThread = Array.from({ length: 80 }, (_, i) =>
          message(`other-${i}`),
        );
        act(() => {
          setMessages!(otherThread);
        });

        // Each row on screen is the element the virtualizer tracks for its
        // key. A row of the old thread left behind, if measured again, is read
        // by its old index against the new thread and takes the place of the
        // new row at that index — which then stops being observed, so its
        // growth (a streaming reply) would go unmeasured.
        const rows = [...document.querySelectorAll("[data-index]")];
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          const key = virtualizer().options.getItemKey(
            Number(row.getAttribute("data-index")),
          );
          expect(virtualizer().elementsCache.get(key)).toBe(row);
        }
      });

      it("keeps them in place after React discards a switch to a thread that repeats a row key", () => {
        // Folds every "old-" message into one row keyed "history", in
        // whichever thread is showing.
        const groupMessages: GroupMessages = (list) => {
          const old = list.filter((m) => m.id.startsWith("old-"));
          const rest = list.filter((m) => !m.id.startsWith("old-"));
          return [
            ...(old.length > 0
              ? [
                  messageGroup({
                    key: "history",
                    messages: old,
                    wrapper: HistoryWrapper,
                  }),
                ]
              : []),
            ...rest.map(messageRow),
          ];
        };
        // The same thread once two earlier messages are folded into a row at
        // the top, and another thread with a row under the same key.
        const withHistory = [
          thread[0]!,
          message("old-a-1"),
          message("old-a-2"),
          ...thread.slice(1),
        ];
        const otherThread = [
          message("other-first"),
          message("old-b-1"),
          ...Array.from({ length: 78 }, (_, i) => message(`other-${i}`)),
        ];
        const never = new Promise<never>(() => {});
        function SuspendsWhile({ pending }: { pending: boolean }) {
          if (pending) throw never;
          return null;
        }
        let update: (messages: Message[], pending: boolean) => void;
        function DiscardingHarness() {
          const [messages, setThread] = React.useState(thread);
          const [pending, setPending] = React.useState(false);
          update = (next, nextPending) => {
            setThread(next);
            setPending(nextPending);
          };
          return (
            <ScrollPinnedContext.Provider value={true}>
              <React.Suspense fallback={null}>
                <CopilotChatMessageView
                  messages={messages}
                  groupMessages={groupMessages}
                />
                <SuspendsWhile pending={pending} />
              </React.Suspense>
            </ScrollPinnedContext.Provider>
          );
        }
        renderWithCopilotKit({
          children: (
            <ScrollElementContext.Provider value={container}>
              <DiscardingHarness />
            </ScrollElementContext.Provider>
          ),
        });
        settleAtBottom();
        // The history row appears above the viewport, unmeasured, at this
        // thread's current mean.
        act(() => {
          update(withHistory, false);
        });
        expect(virtualizer().options.getItemKey(0)).toBe(
          "copilotkit-group:history",
        );
        const before = topRowStarts();
        const historySize = virtualizer().measurementsCache[0]!.size;
        expect(historySize).toBeGreaterThan(300);

        // The other thread renders, then a sibling suspends and React throws
        // the render away. A second transition supersedes it.
        act(() => {
          React.startTransition(() => update(otherThread, true));
        });
        act(() => {
          React.startTransition(() => update(withHistory, false));
        });
        act(() => {
          update([...withHistory, message("sent")], false);
        });

        // The first thread never left the screen, so its rows keep their
        // estimates.
        expect(virtualizer().options.count).toBe(82);
        expect(topRowStarts()).toEqual(before);

        // The other thread, once it does commit, lays its "history" row out
        // from its own rows rather than keeping the first thread's estimate.
        heightOf = (index) => (index >= 70 ? 1000 : 500);
        act(() => {
          update(otherThread, false);
        });
        virtualizer().getTotalSize();
        expect(virtualizer().options.getItemKey(0)).toBe(
          "copilotkit-group:history",
        );
        const history = virtualizer().measurementsCache[0]!;
        expect(history.size).not.toBe(historySize);
        expect(history.size).toBe(
          virtualizer().options.estimateSize(virtualizer().options.count),
        );
      });
    });
  });

  describe("scrolling up into rows not measured yet", () => {
    /**
     * A 300-message list in a 600 px viewport, scrolled up to `readingRow` and read
     * 25 px into it. Rows mounted before the reader scrolls (the newest ones)
     * measure exactly their 100 px estimate.
     */
    async function withListReadAt(
      readingRow: number,
      run: (list: {
        container: HTMLDivElement;
        scrollTo: ReturnType<typeof vi.fn>;
        /** Where a row is drawn, relative to the top of the viewport. */
        onScreen: (index: number) => number;
        /** Report rows to the virtualizer as its ResizeObserver does. */
        measure: (rows: ReadonlyArray<readonly [number, number]>) => void;
        /** The reader scrolls by `by` px (negative: up). */
        userScroll: (by: number) => void;
        /** The viewport changes width, as its ResizeObserver reports it. */
        resize: (width: number) => void;
        idle: () => Promise<void>;
        /** Run one animation frame. */
        frame: () => void;
      }) => Promise<void> | void,
    ) {
      let width = 600;
      const container = document.createElement("div");
      Object.defineProperties(container, {
        clientWidth: { get: () => width },
        clientHeight: { value: 600 },
        // The virtualizer reads the viewport size from these.
        offsetWidth: { get: () => width },
        offsetHeight: { value: 600 },
        // What the browser scrolls through: the spacer the rows are drawn in.
        scrollHeight: {
          get: () => {
            const spacer =
              document.querySelector("[data-index]")?.parentElement
                ?.parentElement;
            return spacer?.style.height
              ? parseFloat(spacer.style.height)
              : virtualizer().getTotalSize();
          },
        },
      });
      const viewportObservers = new Set<ResizeObserverCallback>();
      const originalObserver = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element) {
          if (target === container) viewportObservers.add(this.callback);
        }
        unobserve(target: Element) {
          if (target === container) viewportObservers.delete(this.callback);
        }
        disconnect() {
          viewportObservers.delete(this.callback);
        }
      } as typeof ResizeObserver;
      container.getBoundingClientRect = () =>
        ({ top: 0, width: 600, height: 600 }) as DOMRect;
      // A write lands within the scroll range, as the browser keeps it.
      const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
        container.scrollTop = Math.min(
          Math.max(0, top ?? 0),
          container.scrollHeight - container.clientHeight,
        );
        container.dispatchEvent(new Event("scroll"));
      });
      container.scrollTo = scrollTo as unknown as typeof container.scrollTo;
      const rect = vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: HTMLElement) {
          return {
            width: 600,
            height: this.hasAttribute("data-index") ? 100 : 0,
          } as DOMRect;
        });
      // Frames run only when a test asks: the scroll to the newest message on
      // mount would otherwise keep reconciling and take the list back down.
      const frames = new Map<number, FrameRequestCallback>();
      let nextFrame = 0;
      const requestFrame = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((callback) => {
          frames.set(++nextFrame, callback);
          return nextFrame;
        });
      const cancelFrame = vi
        .spyOn(window, "cancelAnimationFrame")
        .mockImplementation((id) => {
          frames.delete(id);
        });
      const idle = () =>
        act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
        });
      const onScreen = (index: number) => {
        const row = document.querySelector<HTMLElement>(
          `[data-index="${index}"]`,
        );
        if (!row) throw new Error(`row ${index} is not drawn`);
        return (
          translateY(row) + translateY(row.parentElement) - container.scrollTop
        );
      };
      try {
        renderWithCopilotKit({
          children: (
            <ScrollElementContext.Provider value={container}>
              <Harness
                isPinnedToBottom={false}
                initialMessages={Array.from({ length: 300 }, (_, index) =>
                  message(`m-${index}`),
                )}
              />
            </ScrollElementContext.Provider>
          ),
        });
        frames.clear();
        // The reader scrolls up to `readingRow`. Rows mounted during a scroll are
        // not measured on mount; they keep the height they were laid out
        // with until the ResizeObserver reports them.
        act(() => {
          container.scrollTop =
            virtualizer().measurementsCache[readingRow]!.start + 25;
          container.dispatchEvent(new Event("scroll"));
        });
        await run({
          container,
          scrollTo,
          onScreen,
          measure: (rows) =>
            act(() => {
              for (const [index, height] of rows) {
                const instance = virtualizer();
                const drawn = document.querySelector(`[data-index="${index}"]`)
                  ? onScreen(index)
                  : undefined;
                const element = {
                  isConnected: true,
                  dataset: { index: String(index) },
                  getBoundingClientRect: () =>
                    ({ height, top: drawn }) as DOMRect,
                } as unknown as Element;
                instance.resizeItem(
                  index,
                  instance.options.measureElement(element, undefined, instance),
                );
              }
            }),
          userScroll: (by) =>
            act(() => {
              container.scrollTop += by;
              container.dispatchEvent(new Event("scroll"));
            }),
          resize: (nextWidth) =>
            act(() => {
              width = nextWidth;
              for (const callback of viewportObservers) {
                callback(
                  [
                    {
                      target: container,
                      borderBoxSize: [{ inlineSize: width, blockSize: 600 }],
                    },
                  ] as unknown as ResizeObserverEntry[],
                  {} as ResizeObserver,
                );
              }
            }),
          idle,
          frame: () =>
            act(() => {
              const pending = [...frames.values()];
              frames.clear();
              pending.forEach((callback) => callback(performance.now()));
              // A write fires its scroll event before the next frame.
              container.dispatchEvent(new Event("scroll"));
            }),
        });
      } finally {
        // TanStack's scroll-end debounce can notify after its listener is removed.
        await idle();
        cleanup();
        rect.mockRestore();
        requestFrame.mockRestore();
        cancelFrame.mockRestore();
        globalThis.ResizeObserver = originalObserver;
      }
    }

    // Two rows that render nothing and a short one, reported top first. Each
    // measurement changes the estimate for rows not measured yet; rows
    // 191–199 were already laid out, and a new estimate for them would move
    // everything below, which no scroll correction covers.
    const rowsAboveTheReader = [
      [190, 0],
      [191, 0],
      [192, 36],
    ] as const;

    it("keeps the reading row still while the reader scrolls", async () => {
      await withListReadAt(200, ({ scrollTo, onScreen, measure }) => {
        expect(onScreen(200)).toBe(-25);
        expect(virtualizer().itemSizeCache.has(191)).toBe(false);
        scrollTo.mockClear();

        measure(rowsAboveTheReader);

        expect(onScreen(200)).toBe(-25);
        // Safari drops a scrollTop written during a trackpad scroll, or
        // applies it a frame late: nothing is written until it stops.
        expect(scrollTo).not.toHaveBeenCalled();
      });
    });

    it("holds a row drawn above the viewport that the virtualizer still places lower", async () => {
      await withListReadAt(200, ({ onScreen, measure }) => {
        // Within one batch the virtualizer's offset for row 199 lags behind
        // the list offset, which already moved by the 500 px held for rows
        // 194–198: row 199 would look inside the viewport. It is drawn above.
        expect(onScreen(199)).toBeLessThan(0);

        measure([
          [194, 0],
          [195, 0],
          [196, 0],
          [197, 0],
          [198, 0],
          [199, 0],
        ]);

        expect(onScreen(200)).toBe(-25);
      });
    });

    it("settles the held correction a few pixels per frame once scrolling stops", async () => {
      await withListReadAt(
        200,
        async ({ container, onScreen, measure, idle, frame }) => {
          const before = container.scrollTop;
          measure(rowsAboveTheReader);

          await idle();
          // Settling waits for a frame, after that frame's input.
          expect(container.scrollTop).toBe(before);

          let previous = container.scrollTop;
          for (let k = 0; k < 80; k++) {
            frame();
            expect(
              Math.abs(container.scrollTop - previous),
            ).toBeLessThanOrEqual(4);
            expect(onScreen(200)).toBe(-25);
            previous = container.scrollTop;
          }

          // 100 + 100 + 64 px less above the reader, now in scrollTop.
          expect(container.scrollTop).toBe(before - 264);
          const row =
            document.querySelector<HTMLElement>('[data-index="200"]')!;
          expect(translateY(row.parentElement)).toBe(0);
        },
      );
    });

    it("stops settling when the reader scrolls again", async () => {
      await withListReadAt(
        200,
        async ({ container, onScreen, measure, userScroll, idle, frame }) => {
          measure(rowsAboveTheReader);
          await idle();
          frame();
          frame();
          const settled = container.scrollTop;

          userScroll(-10);
          frame();
          frame();

          // Only the reader moved it; the rest of the correction stays held.
          expect(container.scrollTop).toBe(settled - 10);
          expect(onScreen(200)).toBe(-15);
        },
      );
    });

    it("corrects the scroll position at once when the reader is not scrolling", async () => {
      await withListReadAt(
        200,
        async ({ scrollTo, onScreen, measure, idle }) => {
          await idle();
          scrollTo.mockClear();

          measure(rowsAboveTheReader);

          expect(onScreen(200)).toBe(-25);
          expect(scrollTo).toHaveBeenCalled();
        },
      );
    });

    it("holds a correction that arrives while an earlier one is still settling", async () => {
      await withListReadAt(
        293,
        async ({ scrollTo, onScreen, measure, idle }) => {
          // 264 px less above the reader, held while scrolling.
          measure([
            [289, 0],
            [290, 0],
            [291, 36],
          ]);
          // Scrolling has stopped; the held correction has not settled yet.
          await idle();
          scrollTo.mockClear();

          // A row above grows by 200 px. Written now, as list offset minus the
          // held offset, the target lies past the end of the element's
          // current scroll range and the browser cuts the write short.
          measure([[292, 300]]);

          expect(onScreen(293)).toBe(-25);
          expect(scrollTo).not.toHaveBeenCalled();
        },
      );
    });

    it("stops the first row at the top of the viewport when the reader reaches it", async () => {
      await withListReadAt(
        200,
        ({ container, onScreen, measure, userScroll }) => {
          // 264 px less above the reader than estimated, held while scrolling.
          measure(rowsAboveTheReader);

          // Scrolled up to where 100 px of the list are left above the
          // viewport, but the held offset says 264 px less content: the first
          // row would be drawn 164 px down, below a blank band.
          userScroll(100 - container.scrollTop);
          expect(onScreen(0)).toBe(0);

          // Scrolling on toward the top keeps it there, as at a scroll boundary.
          userScroll(-60);
          expect(onScreen(0)).toBe(0);
          userScroll(-40);
          expect(container.scrollTop).toBe(0);
          expect(onScreen(0)).toBe(0);
        },
      );
    });

    it("does not leave the viewport blank after scrolling to the top in one go", async () => {
      await withListReadAt(
        200,
        ({ container, onScreen, measure, userScroll }) => {
          // Ten rows above the reader render nothing: 1,000 px held.
          measure(Array.from({ length: 10 }, (_, k) => [190 + k, 0] as const));

          userScroll(-container.scrollTop);

          expect(onScreen(0)).toBe(0);
        },
      );
    });

    it("never holds a correction past the top of the list", async () => {
      await withListReadAt(2, ({ onScreen, measure }) => {
        expect(onScreen(3)).toBe(75);

        // The rows above the reader render nothing, row 2 included, which
        // reaches 75 px into the viewport: there is not enough content left
        // above row 3 to keep it where it was.
        measure([
          [0, 0],
          [1, 0],
          [2, 0],
        ]);

        expect(onScreen(0)).toBe(0);
        expect(onScreen(3)).toBe(0);
      });
    });

    it("keeps the reading row when the width changes while a correction is held near the bottom", async () => {
      await withListReadAt(290, ({ onScreen, measure, resize, frame }) => {
        // Rows above the reader turn out 600 px taller, held while scrolling.
        // The list can now scroll 600 px further than the element it is drawn
        // in until the correction settles.
        measure([
          [287, 300],
          [288, 300],
          [289, 300],
        ]);
        expect(onScreen(290)).toBe(-25);

        resize(500);
        frame();

        expect(onScreen(290)).toBe(-25);
      });
    });
  });
});
