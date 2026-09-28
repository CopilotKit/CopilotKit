import { render } from "@testing-library/vue";
import { defineComponent, nextTick } from "vue";
import { expect, test, vi } from "vitest";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../CopilotChatConfigurationProvider.vue";
import CopilotChatAssistantMessage from "../../components/chat/CopilotChatAssistantMessage.vue";

test("explicit production Inspector configuration mounts only the product mode without message shortcuts", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const view = render(
    defineComponent({
      components: {
        CopilotKitProvider,
        CopilotChatConfigurationProvider,
        CopilotChatAssistantMessage,
      },
      template: `<CopilotKitProvider runtime-url="/api/copilotkit" :intelligence-inspector="{ appUrl: 'https://intelligence.example/inspector.html' }">
      <CopilotChatConfigurationProvider thread-id="thread-1">
        <CopilotChatAssistantMessage :message="{ id: 'm1', role: 'assistant', content: 'Recorded answer' }" />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>`,
    }),
  );
  try {
    await vi.dynamicImportSettled();
    await nextTick();

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
  const view = render(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
      enableInspector: false,
      intelligenceInspector: {
        appUrl: "https://intelligence.example/inspector.html",
      },
    },
    slots: { default: "Host" },
  });
  try {
    await vi.dynamicImportSettled();
    await nextTick();

    expect(document.querySelector("cpk-web-inspector")).toBeNull();
  } finally {
    view.unmount();
    vi.unstubAllEnvs();
  }
});
