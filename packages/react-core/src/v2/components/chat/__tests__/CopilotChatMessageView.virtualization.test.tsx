import React from "react";
import { render, waitFor } from "@testing-library/react";
import type { Message } from "@ag-ui/core";
import { vi } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import CopilotChatMessageView from "../CopilotChatMessageView";
import { ScrollElementContext } from "../scroll-element-context";

const virtualizerMocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn(),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: virtualizerMocks.useVirtualizer,
}));

function createScrollElement() {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: 600,
  });
  return element;
}

function createMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: "assistant" as const,
    content: `Message ${index}`,
  }));
}

function renderVirtualizedMessages(scrollElement: HTMLElement) {
  return render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider agentId="default" threadId="thread">
        <ScrollElementContext.Provider value={scrollElement}>
          <CopilotChatMessageView messages={createMessages(60)} />
        </ScrollElementContext.Provider>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

describe("CopilotChatMessageView virtualization stability", () => {
  beforeEach(() => {
    virtualizerMocks.measureElement.mockReset();
    virtualizerMocks.scrollToIndex.mockReset();
    virtualizerMocks.useVirtualizer.mockReset();
    virtualizerMocks.useVirtualizer.mockReturnValue({
      getTotalSize: () => 6_000,
      getVirtualItems: () => [
        { index: 0, key: "message-0", start: 0, end: 100, size: 100 },
      ],
      measureElement: virtualizerMocks.measureElement,
      scrollToIndex: virtualizerMocks.scrollToIndex,
    });
  });

  it("disables native scroll anchoring only while virtualized", async () => {
    const scrollElement = createScrollElement();
    scrollElement.style.overflowAnchor = "auto";

    const { unmount } = renderVirtualizedMessages(scrollElement);

    await waitFor(() => {
      expect(scrollElement.style.overflowAnchor).toBe("none");
    });

    unmount();
    expect(scrollElement.style.overflowAnchor).toBe("auto");
  });

  it("uses stable message keys and the ResizeObserver-aware default measurement", () => {
    const scrollElement = createScrollElement();

    renderVirtualizedMessages(scrollElement);

    const options = virtualizerMocks.useVirtualizer.mock.calls.at(-1)?.[0];
    expect(options).toBeDefined();
    expect(options.measureElement).toBeUndefined();
    expect(options.getItemKey(0)).toBe("message-0");
    expect(options.getItemKey(100)).toBe(100);
  });
});
