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
  it("sets spacer height to required - contentHeight on new send (subtracting natural content, not over-allocating)", async () => {
    const { rerender, getByTestId } = render(
      <Harness lastUserMessage={{ id: null, sendNonce: 0 }} />,
    );

    const scroll = getByTestId("scroll");
    const content = getByTestId("content");
    const spacer = getByTestId("spacer");
    setHeight(scroll, 800);
    setHeight(content, 200);

    const userMsg = scroll.querySelector(
      '[data-message-id="m3"]',
    ) as HTMLElement;
    // userMsg at offset 100 in scrollEl, height 40, no top padding.
    userMsg.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 0,
        right: 100,
        bottom: 140,
        width: 100,
        height: 40,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    act(() => {
      rerender(<Harness lastUserMessage={{ id: "m3", sendNonce: 1 }} />);
    });

    // required = userMsgOffset(100) + paddingTop(0) + viewport(800) - topOffset(16) = 884
    // spacer = max(0, required - contentHeight(200)) = 684
    expect(spacer.style.height).toBe("684px");
  });

  it("calls scrollTo with userMsgOffset + paddingTop - topOffset on new send", async () => {
    const { rerender, getByTestId } = render(
      <Harness lastUserMessage={{ id: null, sendNonce: 0 }} />,
    );

    const scroll = getByTestId("scroll");
    setHeight(scroll, 800);
    const scrollTo = scroll.scrollTo as unknown as ReturnType<typeof vi.fn>;

    const userMsg = scroll.querySelector(
      '[data-message-id="m3"]',
    ) as HTMLElement;
    // mock top=400 on userMsg and top=0 on scroll → offset = 400.
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
      setHeight(content, 200);

      const userMsg = scroll.querySelector(
        '[data-message-id="m3"]',
      ) as HTMLElement;
      userMsg.getBoundingClientRect = () =>
        ({
          top: 100,
          left: 0,
          right: 100,
          bottom: 140,
          width: 100,
          height: 40,
          x: 0,
          y: 100,
          toJSON: () => ({}),
        }) as DOMRect;

      act(() => {
        rerender(<Harness lastUserMessage={{ id: "m3", sendNonce: 1 }} />);
      });

      // initial: required(884) - content(200) = 684
      expect(spacer.style.height).toBe("684px");

      // content grows: required(884) - content(600) = 284 < 684 → shrinks
      setHeight(content, 600);
      act(() => observed?.());
      expect(spacer.style.height).toBe("284px");

      // content shrinks back: required(884) - content(100) = 784 > 284 → does NOT grow
      setHeight(content, 100);
      act(() => observed?.());
      expect(spacer.style.height).toBe("284px");
    } finally {
      global.ResizeObserver = prevRO;
    }
  });

  it("re-anchors the user message on content resize so suggestions appearing keep it at topOffset", async () => {
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
      setHeight(scroll, 800);
      setHeight(content, 200);
      const scrollTo = scroll.scrollTo as unknown as ReturnType<typeof vi.fn>;

      const userMsg = scroll.querySelector(
        '[data-message-id="m3"]',
      ) as HTMLElement;
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

      // Initial scroll (smooth) on send.
      expect(scrollTo).toHaveBeenLastCalledWith({
        top: 400 - 16,
        behavior: "smooth",
      });

      // Simulate suggestions appearing — user msg shifts to a new offset.
      userMsg.getBoundingClientRect = () =>
        ({
          top: 460,
          left: 0,
          right: 100,
          bottom: 500,
          width: 100,
          height: 40,
          x: 0,
          y: 460,
          toJSON: () => ({}),
        }) as DOMRect;
      act(() => observed?.());

      // Re-anchored to the new offset, instantly (no smooth animation fight).
      expect(scrollTo).toHaveBeenLastCalledWith({
        top: 460 - 16,
        behavior: "auto",
      });
    } finally {
      global.ResizeObserver = prevRO;
    }
  });

  it("stops re-anchoring once the user scrolls (wheel)", async () => {
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
      setHeight(scroll, 800);
      setHeight(content, 200);
      const scrollTo = scroll.scrollTo as unknown as ReturnType<typeof vi.fn>;

      const userMsg = scroll.querySelector(
        '[data-message-id="m3"]',
      ) as HTMLElement;
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

      const callCountAfterSend = scrollTo.mock.calls.length;

      // User scrolls (wheel), then content resizes — re-anchor must NOT fire.
      act(() => {
        scroll.dispatchEvent(new WheelEvent("wheel"));
      });
      act(() => observed?.());

      expect(scrollTo.mock.calls.length).toBe(callCountAfterSend);
    } finally {
      global.ResizeObserver = prevRO;
    }
  });

  it("cancels the scheduled rAF on unmount (cleanup)", async () => {
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
