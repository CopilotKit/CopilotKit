import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, ref } from "vue";
import { render, waitFor } from "@testing-library/vue";
import type { Message } from "@ag-ui/core";
import type { Attachment } from "@copilotkit/shared";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatView from "../CopilotChatView.vue";
import {
  LastUserMessageKey,
  type LastUserMessageState,
} from "../last-user-message-context";

// Strict counterpart of React `CopilotChatView.inputOverlay.test.tsx`.
// Keep case order, wording, and assertion shape aligned 1:1 with the
// React suite. Vue uses different DOM-level testids in places where the
// React testid does not exist on Vue (e.g. `copilot-send-button` →
// `copilot-chat-input-send`); the *contract* — which container holds
// which child — stays identical.

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleMessages: Message[] = [
  { id: "1", role: "user", content: "Hello" },
  { id: "2", role: "assistant", content: "Hi there!" },
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
  } as Attachment,
];

function makeWrapper(viewProps: Record<string, unknown>) {
  return defineComponent({
    setup() {
      provide(
        LastUserMessageKey,
        ref<LastUserMessageState>({ id: null, sendNonce: 0 }),
      );
      return () =>
        h(CopilotKitProvider, null, {
          default: () =>
            h(
              CopilotChatConfigurationProvider,
              { threadId: "test-thread" },
              {
                default: () =>
                  h(
                    "div",
                    { style: { height: "400px" } },
                    [h(CopilotChatView, viewProps)],
                  ),
              },
            ),
        });
    },
  });
}

async function waitForMount(screen: ReturnType<typeof render>) {
  await screen.findByTestId("copilot-chat-view");
}

describe("CopilotChatView input overlay layout", () => {
  it("renders the input inside an absolute-positioned overlay wrapper on the main view", async () => {
    const screen = render(makeWrapper({ messages: sampleMessages }));
    await waitForMount(screen);

    const overlay = screen.getByTestId("copilot-input-overlay");
    // Class-level assertion — the cpk: prefix avoids false positives from
    // consumer classes. Absolute + bottom-0 is the contract we care about.
    expect(overlay.className).toMatch(/cpk:absolute/);
    expect(overlay.className).toMatch(/cpk:bottom-0/);

    // Input (send button) lives inside the overlay, not outside it.
    const sendButton = screen.getByTestId("copilot-chat-input-send");
    expect(overlay.contains(sendButton)).toBe(true);
  });

  it("renders the attachment queue above the input inside the overlay wrapper", async () => {
    const screen = render(
      makeWrapper({
        messages: sampleMessages,
        attachments: sampleAttachments,
      }),
    );
    await waitForMount(screen);

    const overlay = screen.getByTestId("copilot-input-overlay");
    const queue = overlay.querySelector(
      '[data-testid="copilot-chat-attachment-queue"]',
    );
    const sendButton = overlay.querySelector(
      '[data-testid="copilot-chat-input-send"]',
    );

    expect(queue).not.toBeNull();
    expect(sendButton).not.toBeNull();

    // DOM order: the attachment queue must appear before the send button
    // in document order so it renders visually above the pill.
    const position = queue!.compareDocumentPosition(sendButton!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does NOT wrap the welcome-screen input in the overlay", async () => {
    const screen = render(makeWrapper({ messages: [] }));
    await screen.findByTestId("copilot-chat-view-welcome-screen");

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
      const screen = render(makeWrapper({ messages: sampleMessages }));
      await waitForMount(screen);

      const scrollContent = screen.getByTestId("copilot-scroll-content");

      // The Vue component installs ResizeObservers asynchronously inside
      // `onMounted` — wait until they register before triggering callbacks.
      await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));

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
});
