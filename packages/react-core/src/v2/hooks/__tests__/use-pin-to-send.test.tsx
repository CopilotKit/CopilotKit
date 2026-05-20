import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import React, { useRef } from "react";
import { usePinToSend } from "../use-pin-to-send";
import { LastUserMessageContext } from "../../components/chat/last-user-message-context";

// Small harness that wires the hook up against an in-memory DOM.
// Height mocks are applied via Object.defineProperty because jsdom doesn't run layout.
function setHeight(el: HTMLElement, height: number) {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    value: height,
  });
  el.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      width: 100,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

// Inner component so the hook is mounted inside the Provider and can read context.
function HarnessInner({ topOffset }: { topOffset: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  usePinToSend({ scrollRef, contentRef, spacerRef, topOffset });

  return (
    <div ref={scrollRef} data-testid="scroll">
      <div ref={contentRef} data-testid="content">
        <div data-message-id="m1" data-role="user">
          user msg 1
        </div>
        <div data-message-id="m2" data-role="assistant">
          asst msg 1
        </div>
        <div data-message-id="m3" data-role="user">
          user msg 2
        </div>
      </div>
      <div ref={spacerRef} data-testid="spacer" style={{ height: 0 }} />
    </div>
  );
}

function Harness({
  lastUserMessage,
  topOffset = 16,
}: {
  lastUserMessage: { id: string | null; sendNonce: number };
  topOffset?: number;
}) {
  return (
    <LastUserMessageContext.Provider value={lastUserMessage}>
      <HarnessInner topOffset={topOffset} />
    </LastUserMessageContext.Provider>
  );
}

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  // jsdom does not run rAF callbacks — stub it to fire synchronously so scroll assertions work.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

describe("usePinToSend", () => {
  it("sets spacer height to viewportHeight - userMessageHeight - topOffset on new send", async () => {
    const { rerender, getByTestId } = render(
      <Harness lastUserMessage={{ id: null, sendNonce: 0 }} />,
    );

    const scroll = getByTestId("scroll");
    const spacer = getByTestId("spacer");
    setHeight(scroll, 800);

    const userMsg = scroll.querySelector(
      '[data-message-id="m3"]',
    ) as HTMLElement;
    setHeight(userMsg, 40);

    act(() => {
      rerender(<Harness lastUserMessage={{ id: "m3", sendNonce: 1 }} />);
    });

    // viewport=800, userMsg=40, topOffset=16
    // spacer = max(0, 800 - 40 - 16) = 744
    expect(spacer.style.height).toBe("744px");
  });

  it("calls scrollTo with targetEl.offsetTop - topOffset on new send", async () => {
    const { rerender, getByTestId } = render(
      <Harness lastUserMessage={{ id: null, sendNonce: 0 }} />,
    );

    const scroll = getByTestId("scroll");
    setHeight(scroll, 800);
    const scrollTo = scroll.scrollTo as unknown as ReturnType<typeof vi.fn>;

    const userMsg = scroll.querySelector(
      '[data-message-id="m3"]',
    ) as HTMLElement;
    setHeight(userMsg, 40);
    // computeOffsetTop uses getBoundingClientRect; mock top=400 on userMsg and top=0 on scroll
    // so that elRect.top - stopRect.top + scrollEl.scrollTop = 400 - 0 + 0 = 400.
    userMsg.getBoundingClientRect = () =>
      ({
        top: 400,
        left: 0,
        right: 100,
        bottom: 440,
        width: 100,
        height: 40,
        x: 0,
        y: 400,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      rerender(<Harness lastUserMessage={{ id: "m3", sendNonce: 1 }} />);
    });

    // Allow rAF to fire
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(scrollTo).toHaveBeenCalledWith({
      top: 400 - 16,
      behavior: "smooth",
    });
  });

  it("shrinks spacer as content height grows (does not grow it)", async () => {
    let observed: (() => void) | null = null;
    const ROStub = vi.fn().mockImplementation((cb: () => void) => {
      observed = cb;
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    const prevRO = global.ResizeObserver;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.ResizeObserver = ROStub as any;

    try {
      const { rerender, getByTestId } = render(
        <Harness lastUserMessage={{ id: null, sendNonce: 0 }} />,
      );
      const scroll = getByTestId("scroll");
      const content = getByTestId("content");
      const spacer = getByTestId("spacer");
      setHeight(scroll, 800);
      const userMsg = scroll.querySelector(
        '[data-message-id="m3"]',
      ) as HTMLElement;
      setHeight(userMsg, 40);
      setHeight(content, 200);

      act(() => {
        rerender(<Harness lastUserMessage={{ id: "m3", sendNonce: 1 }} />);
      });

      // Initial: 800 - 40 - 16 = 744
      expect(spacer.style.height).toBe("744px");

      // Simulate content growing — spacer should shrink
      setHeight(content, 600);
      act(() => observed?.());
      expect(parseInt(spacer.style.height, 10)).toBeLessThan(744);

      // Simulate content shrinking — spacer should NOT grow back
      setHeight(content, 100);
      const shrunkHeight = spacer.style.height;
      act(() => observed?.());
      expect(spacer.style.height).toBe(shrunkHeight);
    } finally {
      global.ResizeObserver = prevRO;
    }
  });

  it("cancels the scheduled rAF on unmount (cleanup)", async () => {
    // Use a real rAF handle so we can assert the cancel was issued with it.
    const cancelSpy = vi.spyOn(global, "cancelAnimationFrame");
    try {
      const { rerender, unmount, getByTestId } = render(
        <Harness lastUserMessage={{ id: null, sendNonce: 0 }} />,
      );
      const scroll = getByTestId("scroll");
      setHeight(scroll, 800);
      const userMsg = scroll.querySelector(
        '[data-message-id="m3"]',
      ) as HTMLElement;
      setHeight(userMsg, 40);

      act(() => {
        rerender(<Harness lastUserMessage={{ id: "m3", sendNonce: 1 }} />);
      });

      unmount();
      expect(cancelSpy).toHaveBeenCalled();
    } finally {
      cancelSpy.mockRestore();
    }
  });
});
