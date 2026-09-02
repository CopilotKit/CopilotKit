import type { Message } from "@copilotkit/react-core/v2";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAgent: vi.fn(),
  useEffect: (effect: () => void | (() => void)) => {
    effect();
  },
  useRef: <Value,>(value: Value) => ({ current: value }),
}));

vi.mock("react", () => ({
  useEffect: hookMocks.useEffect,
  useRef: hookMocks.useRef,
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
  CopilotChat: vi.fn(),
  useAgent: hookMocks.useAgent,
}));

import { CarSalesChat } from "./car-sales-chat";

const initialMessage =
  "Hi, I'm Fio, your AI car salesman. First, let's get your contact information before we get started.";

function initializeChat(messages: Message[]) {
  const addMessage = vi.fn<(message: Message) => void>();
  hookMocks.useAgent.mockReturnValue({
    agent: {
      addMessage,
      isRunning: false,
      messages,
    },
    isReady: true,
  });

  CarSalesChat({});
  vi.advanceTimersByTime(500);

  return addMessage;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CarSalesChat initialization", () => {
  test("treats a restored non-empty thread as initialized", () => {
    const addMessage = initializeChat([
      {
        id: "restored-user-message",
        role: "user",
        content: "Show me an electric car",
      },
    ]);

    expect(addMessage).not.toHaveBeenCalled();
  });

  test("adds one welcome message to an empty thread", () => {
    const addMessage = initializeChat([]);

    expect(addMessage).toHaveBeenCalledOnce();
    expect(addMessage).toHaveBeenCalledWith({
      id: expect.any(String),
      role: "assistant",
      content: initialMessage,
    });
  });
});
