/**
 * @vitest-environment jsdom
 */
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(async (message: unknown) => message),
  setChatInstructions: vi.fn(),
  setInternalErrorHandler: vi.fn(),
  removeInternalErrorHandler: vi.fn(),
}));

vi.mock("@copilotkit/react-core", () => ({
  useCopilotContext: () => ({
    additionalInstructions: [],
    setChatInstructions: mocks.setChatInstructions,
    copilotApiConfig: {
      publicApiKey: undefined,
      chatApiEndpoint: "/api/copilotkit",
    },
    setBannerError: vi.fn(),
    setInternalErrorHandler: mocks.setInternalErrorHandler,
    removeInternalErrorHandler: mocks.removeInternalErrorHandler,
  }),
  useCopilotChatInternal: () => ({
    messages: [],
    isLoading: false,
    sendMessage: mocks.sendMessage,
    stopGeneration: vi.fn(),
    reloadMessages: vi.fn(),
    suggestions: [],
    isLoadingSuggestions: false,
    agent: {},
  }),
}));

import { CopilotChat } from "./index";
import type { CopilotChatRef } from "./index";

describe("CopilotChat ref", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("sends text through the existing message pipeline", async () => {
    const ref = createRef<CopilotChatRef>();

    await act(async () => {
      root.render(
        <CopilotChat
          ref={ref}
          Messages={({ children }) => <>{children}</>}
          Input={() => null}
        />,
      );
    });

    expect(ref.current).not.toBeNull();

    await act(async () => {
      await ref.current!.sendMessage("evaluate my traces");
    });

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      id: expect.any(String),
      content: "evaluate my traces",
      role: "user",
    });
  });

  it("does not send whitespace-only text", async () => {
    const ref = createRef<CopilotChatRef>();

    await act(async () => {
      root.render(
        <CopilotChat
          ref={ref}
          Messages={({ children }) => <>{children}</>}
          Input={() => null}
        />,
      );
    });

    await act(async () => {
      await ref.current!.sendMessage("   ");
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
