import type { AssistantMessage } from "@ag-ui/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotChatAssistantMessage } from "../../components/chat/CopilotChatAssistantMessage";
import { CopilotChatConfigurationProvider } from "../CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../CopilotKitProvider";

const assistantMessage: AssistantMessage = {
  id: "assistant-message",
  role: "assistant",
  content: "A response to inspect.",
};

const originalLocation = Object.getOwnPropertyDescriptor(window, "location");

function renderAssistantMessage(
  hostname: string,
  showDevConsole: boolean | "auto" = true,
) {
  Object.defineProperty(window, "location", {
    value: { hostname },
    configurable: true,
  });

  return render(
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      showDevConsole={showDevConsole}
    >
      <CopilotChatConfigurationProvider threadId="thread-id">
        <CopilotChatAssistantMessage message={assistantMessage} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();

  if (originalLocation) {
    Object.defineProperty(window, "location", originalLocation);
  }
});

describe("CopilotKitProvider local Inspector action", () => {
  it("renders in development on localhost when the Inspector is enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");

    renderAssistantMessage("localhost");
    await act(async () => {});

    expect(
      screen.getByRole("button", { name: /view in inspector/i }),
    ).toBeDefined();
  });

  it("does not render in production, even on localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");

    renderAssistantMessage("localhost");
    await act(async () => {});

    expect(
      screen.queryByRole("button", { name: /view in inspector/i }),
    ).toBeNull();
  });

  it("does not render on a non-local domain, even in development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    renderAssistantMessage("example.com");
    await act(async () => {});

    expect(
      screen.queryByRole("button", { name: /view in inspector/i }),
    ).toBeNull();
  });

  it("does not render when the Inspector is disabled", async () => {
    vi.stubEnv("NODE_ENV", "development");

    renderAssistantMessage("localhost", false);
    await act(async () => {});

    expect(
      screen.queryByRole("button", { name: /view in inspector/i }),
    ).toBeNull();
  });
});
