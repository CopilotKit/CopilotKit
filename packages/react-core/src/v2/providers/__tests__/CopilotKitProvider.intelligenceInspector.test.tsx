import { act, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotChatAssistantMessage } from "../../components/chat/CopilotChatAssistantMessage";
import { CopilotChatConfigurationProvider } from "../CopilotChatConfigurationProvider";

test("explicit production Inspector configuration mounts only the product mode without message shortcuts", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const view = render(
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      intelligenceInspector={{
        appUrl: "https://intelligence.example/inspector.html",
      }}
    >
      <CopilotChatConfigurationProvider threadId="thread-1">
        <CopilotChatAssistantMessage
          message={{ id: "m1", role: "assistant", content: "Recorded answer" }}
        />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
  try {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const inspector = document.querySelector("cpk-web-inspector");
    expect(inspector).not.toBeNull();
    expect(inspector).toHaveProperty("intelligenceOnly", true);
    expect(inspector).toHaveProperty(
      "intelligenceAppUrl",
      "https://intelligence.example/inspector.html",
    );
    expect(view.queryByTestId("copilot-inspector-button")).toBeNull();
  } finally {
    view.unmount();
    vi.unstubAllEnvs();
  }
});

test("explicit disable takes precedence over production Inspector configuration", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const view = render(
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      enableInspector={false}
      intelligenceInspector={{
        appUrl: "https://intelligence.example/inspector.html",
      }}
    >
      Host
    </CopilotKitProvider>,
  );
  try {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(document.querySelector("cpk-web-inspector")).toBeNull();
  } finally {
    view.unmount();
    vi.unstubAllEnvs();
  }
});
