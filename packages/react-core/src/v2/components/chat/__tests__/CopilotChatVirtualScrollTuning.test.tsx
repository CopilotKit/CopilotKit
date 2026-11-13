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

/** The y offset of an element's `translateY(...)` transform, or 0. */
const translateY = (element: HTMLElement | null | undefined) =>
  Number(
    /translateY\((-?[\d.]+)px\)/.exec(element?.style.transform ?? "")?.[1] ?? 0,
  );

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
