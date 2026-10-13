/** @vitest-environment jsdom */

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  useAgent: vi.fn(),
  useStageBuildCar: vi.fn(),
  useStageConfirmOrder: vi.fn(),
  useStageGetContactInfo: vi.fn(),
  useStageGetFinancingInfo: vi.fn(),
  useStageGetPaymentInfo: vi.fn(),
  useStageSellFinancing: vi.fn(),
}));

const chatProps = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/stages", () => ({
  useStageBuildCar: hookMocks.useStageBuildCar,
  useStageConfirmOrder: hookMocks.useStageConfirmOrder,
  useStageGetContactInfo: hookMocks.useStageGetContactInfo,
  useStageGetFinancingInfo: hookMocks.useStageGetFinancingInfo,
  useStageGetPaymentInfo: hookMocks.useStageGetPaymentInfo,
  useStageSellFinancing: hookMocks.useStageSellFinancing,
}));

vi.mock("./chat-message", () => ({
  AssistantMessage: () => null,
  UserMessage: () => null,
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotChat: (props: Record<string, unknown>): ReactNode => {
    chatProps.calls.push(props);
    return null;
  },
  useAgent: hookMocks.useAgent,
}));

import { CarSalesChat } from "./car-sales-chat";

const initialMessage =
  "Hi, I'm Fio, your AI car salesman. First, let's get your contact information before we get started.";

const stageHooks = [
  hookMocks.useStageGetContactInfo,
  hookMocks.useStageBuildCar,
  hookMocks.useStageSellFinancing,
  hookMocks.useStageGetPaymentInfo,
  hookMocks.useStageGetFinancingInfo,
  hookMocks.useStageConfirmOrder,
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  chatProps.calls = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

/** Mounts one chat instance through a real React root. */
function mountChat(): void {
  act(() => root.render(<CarSalesChat />));
}

test("registers every sales stage when it mounts", () => {
  mountChat();

  for (const stageHook of stageHooks) {
    expect(stageHook).toHaveBeenCalledOnce();
  }
});

test("hands the greeting to the chat as welcome configuration", () => {
  mountChat();

  const props = chatProps.calls.at(-1);
  expect(props?.agentId).toBe("default");
  expect(props?.labels).toEqual({ welcomeMessageText: initialMessage });
});

test("never reads the agent, so the greeting cannot mutate the thread", () => {
  mountChat();

  expect(hookMocks.useAgent).not.toHaveBeenCalled();
});

test("keeps the same instance across rerenders and cleans up on unmount", () => {
  mountChat();
  act(() => root.render(<CarSalesChat className="rerendered" />));

  expect(chatProps.calls).toHaveLength(2);
  for (const stageHook of stageHooks) {
    expect(stageHook).toHaveBeenCalledTimes(2);
  }

  act(() => root.unmount());

  expect(container.childNodes).toHaveLength(0);
});
