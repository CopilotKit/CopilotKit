import type { AssistantMessage } from "@ag-ui/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotChatAssistantMessage } from "../../components/chat/CopilotChatAssistantMessage";
import { CopilotChatConfigurationProvider } from "../CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { stubWindowLocation } from "../../../v1-deprecated/test-helpers/stub-window-location";

const assistantMessage: AssistantMessage = {
  id: "assistant-message",
  role: "assistant",
  content: "A response to inspect.",
};

function renderAssistantMessage(enableInspector?: boolean) {
  return render(
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      enableInspector={enableInspector}
    >
      <CopilotChatConfigurationProvider threadId="thread-id">
        <CopilotChatAssistantMessage message={assistantMessage} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CopilotKitProvider development Inspector action", () => {
  it("renders in development on any browser host", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const restoreLocation = stubWindowLocation("http://192.168.1.25:3000");

    try {
      renderAssistantMessage();
      await act(async () => {});

      expect(
        screen.getByRole("button", { name: /view in inspector/i }),
      ).toBeDefined();
    } finally {
      restoreLocation();
    }
  });

  it("does not render in production, even when explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");

    renderAssistantMessage(true);
    await act(async () => {});

    expect(
      screen.queryByRole("button", { name: /view in inspector/i }),
    ).toBeNull();
  });

  it("does not render when the Inspector is disabled", async () => {
    vi.stubEnv("NODE_ENV", "development");

    renderAssistantMessage(false);
    await act(async () => {});

    expect(
      screen.queryByRole("button", { name: /view in inspector/i }),
    ).toBeNull();
  });
});
