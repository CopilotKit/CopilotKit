import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatView } from "../CopilotChatView";
import { LastUserMessageContext } from "../last-user-message-context";

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setScrollMetrics(
  el: HTMLElement,
  {
    clientHeight,
    scrollHeight,
    scrollTop,
  }: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    value: scrollTop,
  });
}

/** Where an element's box ends, in viewport coordinates. */
function setBottom(el: Element, bottom: number) {
  el.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom,
      width: 0,
      height: bottom,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

// Wrapper to provide required context (same pattern as CopilotChatView.slots.e2e.test.tsx)
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      <div style={{ height: 400 }}>{children}</div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const sampleMessages = [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there!" },
];

// Wait for the ScrollView's `hasMounted` useEffect to flip — the pre-mount
// fallback render does not include the message list, so a findBy on the
// message list is a reliable "mount is done" signal. Without this gate,
// absence assertions pass vacuously against the pre-mount render.
async function waitForMount(screen: {
  findByTestId: (id: string) => Promise<HTMLElement>;
}) {
  await screen.findByTestId("copilot-message-list");
}

describe("CopilotChatView pin-to-send mode", () => {
  it("renders the pin-to-send spacer element when autoScroll='pin-to-send'", async () => {
    const screen = render(
      <TestWrapper>
        <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
          <CopilotChatView autoScroll="pin-to-send" messages={sampleMessages} />
        </LastUserMessageContext.Provider>
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).not.toBeNull();
  });

  it("shows the scroll-to-bottom button after the pin-to-send scroll element mounts and scrolls away from bottom", async () => {
    const ScrollButton = (
      props: React.ButtonHTMLAttributes<HTMLButtonElement>,
    ) => <button data-testid="scroll-to-bottom" {...props} />;

    const screen = render(
      <TestWrapper>
        <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
          <CopilotChatView
            autoScroll="pin-to-send"
            messages={sampleMessages}
            scrollView={{ scrollToBottomButton: ScrollButton }}
          />
        </LastUserMessageContext.Provider>
      </TestWrapper>,
    );

    await waitForMount(screen);

    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    const scrollElement = spacer?.parentElement as HTMLElement | null;
    expect(scrollElement).not.toBeNull();

    setScrollMetrics(scrollElement!, {
      clientHeight: 300,
      scrollHeight: 1000,
      scrollTop: 100,
    });
    // The messages end 400px below the viewport's bottom.
    setBottom(scrollElement!, 300);
    setBottom(spacer!.previousElementSibling!, 700);
    await waitFor(() => {
      fireEvent.scroll(scrollElement!);
      expect(screen.getByTestId("scroll-to-bottom")).toBeTruthy();
    });
  });

  it("hides the scroll-to-bottom button when only the empty spacer is below", async () => {
    const ScrollButton = (
      props: React.ButtonHTMLAttributes<HTMLButtonElement>,
    ) => <button data-testid="scroll-to-bottom" {...props} />;

    const screen = render(
      <TestWrapper>
        <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
          <CopilotChatView
            autoScroll="pin-to-send"
            messages={sampleMessages}
            scrollView={{ scrollToBottomButton: ScrollButton }}
          />
        </LastUserMessageContext.Provider>
      </TestWrapper>,
    );

    await waitForMount(screen);

    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    const scrollElement = spacer?.parentElement as HTMLElement | null;
    expect(scrollElement).not.toBeNull();

    // A sent message pinned to the top: the spacer makes the scroll height
    // 700px past the viewport, but the messages end above its bottom.
    setScrollMetrics(scrollElement!, {
      clientHeight: 300,
      scrollHeight: 1000,
      scrollTop: 0,
    });
    setBottom(scrollElement!, 300);
    setBottom(spacer!.previousElementSibling!, 120);
    fireEvent.scroll(scrollElement!);

    expect(screen.queryByTestId("scroll-to-bottom")).toBeNull();
  });

  it("does not render the spacer when autoScroll='pin-to-bottom'", async () => {
    const screen = render(
      <TestWrapper>
        <CopilotChatView autoScroll="pin-to-bottom" messages={sampleMessages} />
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  it("does not render the spacer when autoScroll='none'", async () => {
    const screen = render(
      <TestWrapper>
        <CopilotChatView autoScroll="none" messages={sampleMessages} />
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  it("boolean true still maps to pin-to-bottom (back-compat)", async () => {
    const screen = render(
      <TestWrapper>
        <CopilotChatView autoScroll={true} messages={sampleMessages} />
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  it("boolean false still maps to none (back-compat)", async () => {
    const screen = render(
      <TestWrapper>
        <CopilotChatView autoScroll={false} messages={sampleMessages} />
      </TestWrapper>,
    );
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });
});
