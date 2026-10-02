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

    it("ignores rows that report no height", () => {
      renderMessageView({ isPinnedToBottom: false });
      const { options } = virtualizer();

      options.measureElement(measuredRow(0, 300), undefined, virtualizer());
      options.measureElement(measuredRow(1, 0), undefined, virtualizer());

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
});
