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

function renderChat(messages: Message[]) {
  const addMessage = vi.fn<(message: Message) => void>();
  hookMocks.useAgent.mockReturnValue({
    agent: {
      addMessage,
      isRunning: false,
      messages,
    },
    isReady: true,
  });

  const view = CarSalesChat({});

  return { addMessage, view };
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
  test("does not overwrite a restored thread whose messages hydrate later", () => {
    const messages: Message[] = [];
    const { addMessage } = renderChat(messages);

    vi.runAllTimers();
    messages.push({
      id: "delayed-restored-user-message",
      role: "user",
      content: "Show me an electric car",
    });

    expect(addMessage).not.toHaveBeenCalled();
  });

  test("treats a restored non-empty thread as initialized", () => {
    const { addMessage } = renderChat([
      {
        id: "restored-user-message",
        role: "user",
        content: "Show me an electric car",
      },
    ]);

    expect(addMessage).not.toHaveBeenCalled();
  });

  test("configures the greeting as welcome content without mutating the thread", () => {
    const { addMessage, view } = renderChat([]);

    vi.runAllTimers();

    expect(addMessage).not.toHaveBeenCalled();
    expect(view.props.children.props.children.props.labels).toEqual({
      welcomeMessageText: initialMessage,
    });
  });
});
