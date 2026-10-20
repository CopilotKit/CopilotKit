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
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ])("renders in local development at %s", async (url) => {
    vi.stubEnv("NODE_ENV", "development");
    const restoreLocation = stubWindowLocation(url);
    try {
      renderAssistantMessage();
      await act(async () => {});
      expect(
        screen.getByRole("button", { name: /copilotkit inspector/i }),
      ).toBeDefined();
    } finally {
      restoreLocation();
    }
  });

  it.each([
    "http://192.168.1.25:3000",
    "https://preview.example.com",
    "https://localhost.example.com",
  ])(
    "never renders on remote host %s, even explicitly enabled",
    async (url) => {
      vi.stubEnv("NODE_ENV", "development");
      const restoreLocation = stubWindowLocation(url);
      try {
        renderAssistantMessage(true);
        await act(async () => {});
        expect(
          screen.queryByRole("button", { name: /copilotkit inspector/i }),
        ).toBeNull();
        expect(document.querySelector("cpk-web-inspector")).toBeNull();
      } finally {
        restoreLocation();
      }
    },
  );

  it("follows Inspector dismissal and expiry without unmounting the Inspector", async () => {
    vi.stubEnv("NODE_ENV", "development");
    renderAssistantMessage();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const inspector = document.querySelector("cpk-web-inspector")!;
    expect(screen.getByTestId("copilot-inspector-button")).toBeDefined();
    act(() => {
      inspector.dispatchEvent(
        new CustomEvent("cpk-inspector-visibility-change", {
          detail: { visible: false },
        }),
      );
    });
    expect(screen.queryByTestId("copilot-inspector-button")).toBeNull();
    expect(inspector.isConnected).toBe(true);
    act(() => {
      inspector.dispatchEvent(
        new CustomEvent("cpk-inspector-visibility-change", {
          detail: { visible: true },
        }),
      );
    });
    expect(screen.getByTestId("copilot-inspector-button")).toBeDefined();
  });

  it("does not render in production, even when explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");

    renderAssistantMessage(true);
    await act(async () => {});

    expect(
      screen.queryByRole("button", { name: /copilotkit inspector/i }),
    ).toBeNull();
  });

  it("does not render when the Inspector is disabled", async () => {
    vi.stubEnv("NODE_ENV", "development");

    renderAssistantMessage(false);
    await act(async () => {});

    expect(
      screen.queryByRole("button", { name: /copilotkit inspector/i }),
    ).toBeNull();
  });
});
