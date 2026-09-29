/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

interface TestMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
}

const chatState = vi.hoisted(() => ({
  addMessage: vi.fn<(message: TestMessage) => void>(),
  hasExplicitThreadId: true,
  messages: [] as TestMessage[],
  threadId: "restored-thread",
  useAgent: vi.fn(),
}));

vi.mock("@/lib/stages", () => ({
  useStageBuildCar: vi.fn(),
  useStageConfirmOrder: vi.fn(),
  useStageGetContactInfo: vi.fn(),
  useStageGetFinancingInfo: vi.fn(),
  useStageGetPaymentInfo: vi.fn(),
  useStageSellFinancing: vi.fn(),
}));

vi.mock("@/lib/utils/cn", () => ({
  cn: (...classNames: Array<string | undefined>) =>
    classNames.filter(Boolean).join(" "),
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotChat: ({ labels }: { labels?: { welcomeMessageText?: string } }) => {
    const assistantMessage = chatState.messages.find(
      (message) => message.role === "assistant",
    );
    const greeting = chatState.hasExplicitThreadId
      ? assistantMessage?.content
      : (labels?.welcomeMessageText ?? assistantMessage?.content);

    return greeting ? <p data-testid="greeting">{greeting}</p> : null;
  },
  useAgent: chatState.useAgent,
}));

import { CarSalesChat } from "./car-sales-chat";

const initialMessage =
  "Hi, I'm Fio, your AI car salesman. First, let's get your contact information before we get started.";

describe("CarSalesChat thread lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    chatState.hasExplicitThreadId = true;
    chatState.messages = [
      {
        id: "restored-user-message",
        role: "user",
        content: "Show me an electric car",
      },
    ];
    chatState.threadId = "restored-thread";
    chatState.addMessage.mockImplementation((message) => {
      chatState.messages.push(message);
    });
    chatState.useAgent.mockImplementation(() => ({
      agent: {
        addMessage: chatState.addMessage,
        isRunning: false,
        messages: chatState.messages,
        threadId: chatState.threadId,
      },
      isReady: true,
    }));

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  test("shows the greeting when a fresh thread follows a restored thread", () => {
    act(() => root.render(<CarSalesChat />));
    expect(container.querySelector('[data-testid="greeting"]')).toBeNull();

    chatState.hasExplicitThreadId = false;
    chatState.messages = [];
    chatState.threadId = "fresh-thread";

    act(() => root.render(<CarSalesChat />));
    act(() => vi.runAllTimers());
    act(() => root.render(<CarSalesChat />));

    expect(
      container.querySelector('[data-testid="greeting"]')?.textContent,
    ).toBe(initialMessage);
    expect(chatState.addMessage).not.toHaveBeenCalled();
  });
});
