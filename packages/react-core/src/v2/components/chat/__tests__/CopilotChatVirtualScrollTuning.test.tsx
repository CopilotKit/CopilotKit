import React from "react";
import { act, cleanup } from "@testing-library/react";
import type { Message } from "@ag-ui/core";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import type * as ReactVirtual from "@tanstack/react-virtual";
import { renderWithCopilotKit } from "../../../__tests__/utils/test-helpers";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
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

function message(id: string): Message {
  return { id, role: "user", content: id } as Message;
}

let setMessages: ((messages: Message[]) => void) | null = null;

function Harness({
  isPinnedToBottom,
  initialMessages = [],
}: {
  isPinnedToBottom: boolean;
  initialMessages?: Message[];
}) {
  const [messages, updateMessages] = React.useState(initialMessages);
  setMessages = updateMessages;
  return (
    <ScrollPinnedContext.Provider value={isPinnedToBottom}>
      <CopilotChatMessageView messages={messages} />
    </ScrollPinnedContext.Provider>
  );
}

function renderMessageView(options: {
  isPinnedToBottom: boolean;
  initialMessages?: Message[];
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

  describe("estimateSize", () => {
    it("falls back to a flat estimate before anything is measured", () => {
      renderMessageView({ isPinnedToBottom: false });
      expect(virtualizer().options.estimateSize(0)).toBe(100);
    });

    it("counts a row once however often it is re-measured", () => {
      renderMessageView({ isPinnedToBottom: false });
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
      renderMessageView({ isPinnedToBottom: false });
      const { options } = virtualizer();

      options.measureElement(measuredRow(0, 300), undefined, virtualizer());
      options.measureElement(measuredRow(1, 0), undefined, virtualizer());

      expect(options.estimateSize(2)).toBe(300);
    });

    it("measures a row that renders nothing as 0 in a visible list", () => {
      renderMessageView({ isPinnedToBottom: false });
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
      renderMessageView({ isPinnedToBottom: false });
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
  });

  describe("scrolling up into rows not measured yet", () => {
    /**
     * A 300-message list in a 600 px viewport, read at row 200. Rows mounted
     * before the reader scrolls measure exactly their 100 px estimate.
     */
    async function withListReadAtRow200(
      run: (list: {
        container: HTMLDivElement;
        scrollTo: ReturnType<typeof vi.fn>;
        /** Where row 200 is drawn, relative to the top of the viewport. */
        readingRowOnScreen: () => number;
        /** Report rows to the virtualizer as its ResizeObserver does. */
        measure: (rows: ReadonlyArray<readonly [number, number]>) => void;
        idle: () => Promise<void>;
      }) => Promise<void> | void,
    ) {
      const container = document.createElement("div");
      Object.defineProperties(container, {
        clientWidth: { value: 600 },
        clientHeight: { value: 600 },
        // The virtualizer reads the viewport size from these.
        offsetWidth: { value: 600 },
        offsetHeight: { value: 600 },
        scrollHeight: { get: () => virtualizer().getTotalSize() },
      });
      container.getBoundingClientRect = () =>
        ({ width: 600, height: 600 }) as DOMRect;
      const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
        container.scrollTop = top ?? 0;
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
      const idle = () =>
        act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
        });
      // Frames never run: the scroll to the newest message on mount would
      // otherwise keep reconciling and take the list back to the bottom.
      const frame = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation(() => 0);
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
        // The reader scrolls up to row 200. Rows mounted during a scroll are
        // not measured on mount; they keep the height they were laid out
        // with until the ResizeObserver reports them.
        act(() => {
          container.scrollTop =
            virtualizer().measurementsCache[200]!.start + 25;
          container.dispatchEvent(new Event("scroll"));
        });
        await run({
          container,
          scrollTo,
          readingRowOnScreen: () => {
            const row =
              document.querySelector<HTMLElement>('[data-index="200"]')!;
            const drawnAt = Number(
              /translateY\((-?[\d.]+)px\)/.exec(row.style.transform)![1],
            );
            return drawnAt - container.scrollTop;
          },
          measure: (rows) =>
            act(() => {
              for (const [index, height] of rows) {
                const instance = virtualizer();
                instance.resizeItem(
                  index,
                  instance.options.measureElement(
                    attachedRow(index, height),
                    undefined,
                    instance,
                  ),
                );
              }
            }),
          idle,
        });
      } finally {
        // TanStack's scroll-end debounce can notify after its listener is removed.
        await idle();
        cleanup();
        rect.mockRestore();
        frame.mockRestore();
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
      await withListReadAtRow200(
        ({ scrollTo, readingRowOnScreen, measure }) => {
          expect(readingRowOnScreen()).toBe(-25);
          expect(virtualizer().itemSizeCache.has(191)).toBe(false);
          scrollTo.mockClear();

          measure(rowsAboveTheReader);

          expect(readingRowOnScreen()).toBe(-25);
          // Safari drops a scrollTop written during a trackpad scroll, or
          // applies it a frame late: nothing is written until it stops.
          expect(scrollTo).not.toHaveBeenCalled();
        },
      );
    });

    it("writes the held correction once scrolling stops, in the same frame as the rows", async () => {
      await withListReadAtRow200(
        async ({ container, readingRowOnScreen, measure, idle }) => {
          const before = container.scrollTop;
          measure(rowsAboveTheReader);

          await idle();

          // 100 + 100 + 64 px less above the reader.
          expect(container.scrollTop).toBe(before - 264);
          expect(readingRowOnScreen()).toBe(-25);
          // Drawn where the virtualizer places it again, nothing held.
          const row =
            document.querySelector<HTMLElement>('[data-index="200"]')!;
          virtualizer().getTotalSize();
          expect(row.style.transform).toBe(
            `translateY(${virtualizer().measurementsCache[200]!.start}px)`,
          );
        },
      );
    });

    it("corrects the scroll position at once when the reader is not scrolling", async () => {
      await withListReadAtRow200(
        async ({ scrollTo, readingRowOnScreen, measure, idle }) => {
          await idle();
          scrollTo.mockClear();

          measure(rowsAboveTheReader);

          expect(readingRowOnScreen()).toBe(-25);
          expect(scrollTo).toHaveBeenCalled();
        },
      );
    });
  });
});
