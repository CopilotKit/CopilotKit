import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotChatHeadless_c } from "../use-copilot-chat-headless_c";

const internalReturn = {
  visibleMessages: [],
  messages: [],
  sendMessage: vi.fn(),
  appendMessage: vi.fn(),
  setMessages: vi.fn(),
  deleteMessage: vi.fn(),
  reloadMessages: vi.fn(),
  stopGeneration: vi.fn(),
  reset: vi.fn(),
  isLoading: false,
  isAvailable: true,
  runChatCompletion: vi.fn(),
  mcpServers: [],
  setMcpServers: vi.fn(),
  suggestions: [],
  setSuggestions: vi.fn(),
  generateSuggestions: vi.fn(),
  resetSuggestions: vi.fn(),
  isLoadingSuggestions: false,
  interrupt: null,
};

vi.mock("../../context/copilot-context", () => ({
  useCopilotContext: () => ({
    copilotApiConfig: { publicApiKey: "ck_pub_test" },
    setBannerError: vi.fn(),
  }),
}));

vi.mock("../use-copilot-chat_internal", () => ({
  defaultSystemMessage: "You are a helpful assistant.",
  useCopilotChatInternal: vi.fn(() => internalReturn),
}));

describe("useCopilotChatHeadless_c deprecation warning", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    warnSpy.mockRestore();
  });

  it("warns once per mounted caller with replacement and migration details", () => {
    const first = renderHook(() => useCopilotChatHeadless_c());

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning = warnSpy.mock.calls[0]?.[0] as string;
    expect(warning).toContain("useCopilotChatHeadless_c is deprecated");
    expect(warning).toContain("useAgent");
    expect(warning).toContain("useCopilotKit().copilotkit.runAgent");
    expect(warning).toContain("/reference/v2/hooks/useAgent");
    expect(warning).toContain("Before:");
    expect(warning).toContain("After:");

    first.rerender();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    renderHook(() => useCopilotChatHeadless_c());
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("does not warn in production", () => {
    process.env.NODE_ENV = "production";

    renderHook(() => useCopilotChatHeadless_c());

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
