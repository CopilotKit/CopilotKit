import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/core";
import CopilotChatMessageView from "../../components/chat/CopilotChatMessageView.svelte";
import CopilotChatInput from "../../components/chat/CopilotChatInput.svelte";
import AssistantToolbarHarness from "./assistant-toolbar-harness.svelte";
import ChatHarness from "./copilot-chat-harness.svelte";
import ChatAgentSwitchHarness from "./chat-agent-switch-harness.svelte";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: "test",
            agents: {},
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("CopilotChatInput", () => {
  const onSubmit = vi.fn();
  const onInputChange = vi.fn();

  it("syncs changed value props and submits trimmed input", async () => {
    const view = render(CopilotChatInput, {
      props: { value: " first ", onSubmit, onInputChange },
    });
    const textarea = view.getByPlaceholderText(
      "Type a message...",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe(" first ");

    await view.rerender({ value: " second ", onSubmit, onInputChange });
    await waitFor(() => expect(textarea.value).toBe(" second "));
    await fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith("second");
  });

  it("reports edits, ignores Shift+Enter, and invokes stop while running", async () => {
    const onStop = vi.fn();
    const view = render(CopilotChatInput, {
      props: { value: "", isRunning: false, onSubmit, onStop, onInputChange },
    });
    const textarea = view.getByPlaceholderText(
      "Type a message...",
    ) as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: "hello" } });
    expect(onInputChange).toHaveBeenCalledWith("hello");
    await fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    await view.rerender({
      value: "hello",
      isRunning: true,
      onSubmit,
      onStop,
      onInputChange,
    });
    await fireEvent.click(view.getByRole("button"));
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe("CopilotChat", () => {
  it("passes reactive controlled inputValue updates through to CopilotChatInput", async () => {
    const view = render(ChatHarness);
    const textarea = view.getByPlaceholderText(
      "Type a message...",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("first draft"));
    await fireEvent.click(view.getByTestId("update-chat-input"));
    await waitFor(() => expect(textarea.value).toBe("updated draft"));
  });

  it("switches the rendered agent when agentId changes after mount", async () => {
    const view = render(ChatAgentSwitchHarness);

    await waitFor(() =>
      expect(view.getByText("Response from agent A")).toBeTruthy(),
    );
    await fireEvent.click(view.getByTestId("switch-chat-agent"));
    await waitFor(() =>
      expect(view.getByText("Response from agent B")).toBeTruthy(),
    );
    expect(view.queryByText("Response from agent A")).toBeNull();
  });
});

describe("CopilotChatMessageView", () => {
  it("pins to the bottom when a streaming message changes without changing message count", async () => {
    const initialMessages = [
      { id: "user-1", role: "user", content: "partial" },
    ] as Message[];
    const view = render(CopilotChatMessageView, {
      props: { messages: initialMessages, isRunning: true, autoScroll: true },
    });
    const container = view.container.querySelector(
      ".copilotkit-message-list",
    ) as HTMLDivElement;
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 500,
    });
    container.scrollTop = 0;

    await view.rerender({
      messages: [
        { id: "user-1", role: "user", content: "complete response" },
      ] as Message[],
      isRunning: true,
      autoScroll: true,
    });

    await waitFor(() => expect(container.scrollTop).toBe(500));
  });
});

describe("CopilotChatAssistantMessage", () => {
  it("keeps the latest assistant toolbar hidden while streaming after a tool result is appended", async () => {
    const view = render(AssistantToolbarHarness);

    await waitFor(() => expect(view.getByText("Still streaming")).toBeTruthy());
    expect(view.queryByTestId("copilot-copy-button")).toBeNull();
  });
});
