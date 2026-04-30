import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotChatView } from "../CopilotChatView";
import { LastUserMessageContext } from "../last-user-message-context";
import type { Attachment } from "@copilotkit/shared";
import type { Message } from "@ag-ui/core";

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

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

const sampleAttachments: Attachment[] = [
  {
    id: "att-1",
    type: "document",
    source: {
      type: "url",
      value: "https://example.com/doc.txt",
      mimeType: "text/plain",
    },
    filename: "example.txt",
    size: 42,
    status: "ready",
  },
];

async function waitForMount(screen: {
  findByTestId: (id: string) => Promise<HTMLElement>;
}) {
  await screen.findByTestId("copilot-message-list");
}

describe("CopilotChatView input overlay layout", () => {
  it("renders the input inside an absolute-positioned overlay wrapper on the main view", async () => {
    const screen = render(
      <TestWrapper>
        <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
          <CopilotChatView messages={sampleMessages} />
        </LastUserMessageContext.Provider>
      </TestWrapper>,
    );
    await waitForMount(screen);

    // getByTestId throws if missing — presence is implicit.
    const overlay = screen.getByTestId("copilot-input-overlay");
    // Class-level assertion — the cpk: prefix avoids false positives from
    // consumer classes. Absolute + bottom-0 is the contract we care about.
    expect(overlay.className).toMatch(/cpk:absolute/);
    expect(overlay.className).toMatch(/cpk:bottom-0/);

    // Input (send button) lives inside the overlay, not outside it.
    const sendButton = screen.getByTestId("copilot-send-button");
    expect(overlay.contains(sendButton)).toBe(true);
  });

  it("renders the attachment queue above the input inside the overlay wrapper", async () => {
    const screen = render(
      <TestWrapper>
        <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
          <CopilotChatView
            messages={sampleMessages}
            attachments={sampleAttachments}
          />
        </LastUserMessageContext.Provider>
      </TestWrapper>,
    );
    await waitForMount(screen);

    const overlay = screen.getByTestId("copilot-input-overlay");
    const queue = overlay.querySelector(
      '[data-testid="copilot-attachment-queue"]',
    );
    const sendButton = overlay.querySelector(
      '[data-testid="copilot-send-button"]',
    );

    expect(queue).not.toBeNull();
    expect(sendButton).not.toBeNull();

    // DOM order: the attachment queue must appear before the send button
    // in document order so it renders visually above the pill.
    const position = queue!.compareDocumentPosition(sendButton!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does NOT wrap the welcome-screen input in the overlay", async () => {
    const screen = render(
      <TestWrapper>
        <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
          <CopilotChatView messages={[]} />
        </LastUserMessageContext.Provider>
      </TestWrapper>,
    );
    await screen.findByTestId("copilot-welcome-screen");

    // Welcome screen present → no overlay wrapper exists in this render.
    expect(screen.queryByTestId("copilot-input-overlay")).toBeNull();
  });

  it("reserves inputContainerHeight as bottom padding on the scroll content", async () => {
    // Spy on ResizeObserver so we can trigger a known height. The component
    // uses ResizeObserver to measure the overlay wrapper; we inject a known
    // value and assert the scroll content's inline padding-bottom reflects it.
    const callbacks: Array<{
      cb: ResizeObserverCallback;
      target: Element | null;
    }> = [];
    const OriginalRO = global.ResizeObserver;
    class MockResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        callbacks.push({ cb: this.cb, target });
      }
      unobserve() {}
      disconnect() {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).ResizeObserver = MockResizeObserver as any;

    try {
      const screen = render(
        <TestWrapper>
          <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
            <CopilotChatView messages={sampleMessages} />
          </LastUserMessageContext.Provider>
        </TestWrapper>,
      );
      await waitForMount(screen);

      const scrollContent = screen.getByTestId("copilot-scroll-content");

      // Simulate the overlay wrapper reporting a content height of 120px.
      for (const { cb } of callbacks) {
        cb(
          [
            {
              contentRect: { height: 120 } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      }

      // After the resize fires, paddingBottom = 120 (input) + 32 (baseline,
      // no suggestions) = "152px". The test asserts the formula.
      await waitFor(() =>
        expect(scrollContent.style.paddingBottom).toBe("152px"),
      );
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).ResizeObserver = OriginalRO;
    }
  });

  it("attaches the resize observer when transitioning from welcome to chat view", async () => {
    // Regression: a `[]`-deps useEffect captured `inputContainerRef.current`
    // as null when mounted on the welcome screen and never re-ran after the
    // user sent their first message. The overlay rendered without a measured
    // height, so paddingBottom stayed at 32 and the last messages slid
    // underneath the absolute-positioned input pill. Verify the observer
    // attaches reactively when the overlay mounts post-transition.
    const callbacks: Array<{
      cb: ResizeObserverCallback;
      target: Element | null;
    }> = [];
    const OriginalRO = global.ResizeObserver;
    class MockResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        callbacks.push({ cb: this.cb, target });
      }
      unobserve() {}
      disconnect() {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).ResizeObserver = MockResizeObserver as any;

    try {
      // Render with no messages to start on the welcome screen branch — the
      // overlay wrapper does not exist in this DOM, so the observer cannot
      // attach yet.
      const initialMessages: Message[] = [];
      const screen = render(
        <TestWrapper>
          <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
            <CopilotChatView messages={initialMessages} />
          </LastUserMessageContext.Provider>
        </TestWrapper>,
      );

      await screen.findByTestId("copilot-welcome-screen");
      expect(screen.queryByTestId("copilot-input-overlay")).toBeNull();

      // Transition to the chat view by re-rendering with messages — mirrors
      // what happens when CopilotChat re-renders after the user submits.
      screen.rerender(
        <TestWrapper>
          <LastUserMessageContext.Provider value={{ id: null, sendNonce: 0 }}>
            <CopilotChatView messages={sampleMessages} />
          </LastUserMessageContext.Provider>
        </TestWrapper>,
      );

      await waitForMount(screen);
      const overlay = screen.getByTestId("copilot-input-overlay");

      // The bug: observer was attached at mount when the overlay element was
      // null, so it never re-attached after the transition. Verify it now
      // observes the overlay specifically.
      await waitFor(() =>
        expect(callbacks.some(({ target }) => target === overlay)).toBe(true),
      );

      const scrollContent = screen.getByTestId("copilot-scroll-content");
      // Simulate the overlay reporting a real height (e.g. 88px input pill).
      // Only fire on the overlay's own observer — other components (e.g. the
      // textarea autosize) also use ResizeObserver and would corrupt the
      // assertion if we fed all observers a 88px contentRect.
      for (const { cb, target } of callbacks) {
        if (target !== overlay) continue;
        cb(
          [
            {
              contentRect: { height: 88 } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      }

      // 88 (input) + 32 (no suggestions baseline) = 120px. Without the fix,
      // paddingBottom would be stuck at 32px because the observer never
      // attached.
      await waitFor(() =>
        expect(scrollContent.style.paddingBottom).toBe("120px"),
      );
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).ResizeObserver = OriginalRO;
    }
  });
});
