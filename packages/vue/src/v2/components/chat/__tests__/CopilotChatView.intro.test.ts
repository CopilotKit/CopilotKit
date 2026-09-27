import { defineComponent } from "vue";
import { render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import CopilotChatView from "../CopilotChatView.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";

const renderView = (props: { introAnimation?: boolean }) =>
  render(
    defineComponent({
      components: {
        CopilotKitProvider,
        CopilotChatConfigurationProvider,
        CopilotChatView,
      },
      setup() {
        return { props };
      },
      template: `
        <CopilotKitProvider runtime-url="/api/copilotkit">
          <CopilotChatConfigurationProvider thread-id="intro">
            <CopilotChatView :messages="[]" v-bind="props" />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      `,
    }),
  );

describe("CopilotChatView intro animation", () => {
  it("is on by default", () => {
    renderView({});
    expect(
      screen.getByTestId("copilot-chat-view").hasAttribute("data-intro"),
    ).toBe(true);
  });

  it("can be turned off", () => {
    renderView({ introAnimation: false });
    expect(
      screen.getByTestId("copilot-chat-view").hasAttribute("data-intro"),
    ).toBe(false);
  });
});
