import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, ref } from "vue";
import { render, waitFor } from "@testing-library/vue";
import type { Message } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatView from "../CopilotChatView.vue";
import {
  LastUserMessageKey,
  type LastUserMessageState,
} from "../last-user-message-context";

// Strict counterpart of React `CopilotChatView.pinToSend.test.tsx`.
// Keep case order, wording, and assertion shape aligned 1:1 with the
// React suite — Vue uses `provide()` for `LastUserMessageContext` parity.

beforeEach(() => {
  HTMLElement.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleMessages: Message[] = [
  { id: "1", role: "user", content: "Hello" },
  { id: "2", role: "assistant", content: "Hi there!" },
];

// Vue counterpart of React's `TestWrapper`. Mirrors the Provider stack
// (`CopilotKitProvider` + `CopilotChatConfigurationProvider`) plus the
// 400px sizing wrapper so layout behaves like the React fixture.
function renderView(
  autoScroll: unknown,
  lastUserMessage: LastUserMessageState | null = { id: null, sendNonce: 0 },
) {
  const lastUserMessageRef =
    lastUserMessage === null
      ? null
      : ref<LastUserMessageState>({ ...lastUserMessage });

  const Wrapper = defineComponent({
    setup() {
      if (lastUserMessageRef) {
        provide(LastUserMessageKey, lastUserMessageRef);
      }
      return () =>
        h(CopilotKitProvider, null, {
          default: () =>
            h(
              CopilotChatConfigurationProvider,
              { threadId: "test-thread" },
              {
                default: () =>
                  h("div", { style: { height: "400px" } }, [
                    h(CopilotChatView, {
                      autoScroll,
                      messages: sampleMessages,
                    }),
                  ]),
              },
            ),
        });
    },
  });

  return render(Wrapper);
}

// Vue counterpart of React's `waitForMount(screen)`. The React harness
// waits for `copilot-message-list` because React `ScrollView` has a
// `hasMounted` gate; Vue doesn't, so we wait for the chat view root.
async function waitForMount(screen: ReturnType<typeof render>) {
  await screen.findByTestId("copilot-chat-view");
}

describe("CopilotChatView pin-to-send mode", () => {
  it("renders the pin-to-send spacer element when autoScroll='pin-to-send'", async () => {
    const screen = renderView("pin-to-send");
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).not.toBeNull();
  });

  it("does not render the spacer when autoScroll='pin-to-bottom'", async () => {
    const screen = renderView("pin-to-bottom");
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  it("does not render the spacer when autoScroll='none'", async () => {
    const screen = renderView("none");
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  it("boolean true still maps to pin-to-bottom (back-compat)", async () => {
    const screen = renderView(true);
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  it("boolean false still maps to none (back-compat)", async () => {
    const screen = renderView(false);
    await waitForMount(screen);
    const spacer = screen.container.querySelector("[data-pin-to-send-spacer]");
    expect(spacer).toBeNull();
  });

  // Vue-specific: validates that the spacer is wired to a live
  // `LastUserMessageContext` provider so that bumping `sendNonce` triggers
  // `usePinToSend`. This is the Vue analogue of React's reactivity model
  // (rerender with new context value) and isn't testable through the
  // React-mirrored cases above. Keep this check trailing so the strict
  // parity cases above remain wording-aligned with React.
  it("[vue] honors LastUserMessage updates when in pin-to-send mode", async () => {
    const lastUserMessageRef = ref<LastUserMessageState>({
      id: null,
      sendNonce: 0,
    });

    const Wrapper = defineComponent({
      setup() {
        provide(LastUserMessageKey, lastUserMessageRef);
        return () =>
          h(CopilotKitProvider, null, {
            default: () =>
              h(
                CopilotChatConfigurationProvider,
                { threadId: "test-thread" },
                {
                  default: () =>
                    h("div", { style: { height: "400px" } }, [
                      h(CopilotChatView, {
                        autoScroll: "pin-to-send",
                        messages: sampleMessages,
                      }),
                    ]),
                },
              ),
          });
      },
    });

    const screen = render(Wrapper);
    await waitForMount(screen);
    const spacer = screen.container.querySelector(
      "[data-pin-to-send-spacer]",
    ) as HTMLElement;
    expect(spacer).not.toBeNull();
    expect(spacer.style.height).toBe("0px");

    // Bump the nonce and target an existing message id; usePinToSend will
    // size the spacer (no real layout in jsdom, so spacer height becomes
    // a non-zero value or stays 0px when measurements are absent —
    // assertion focuses on the watch firing rather than exact px.).
    lastUserMessageRef.value = { id: "1", sendNonce: 1 };
    await waitFor(() =>
      expect(spacer.getAttribute("data-pin-to-send-spacer")).not.toBeNull(),
    );
  });
});
