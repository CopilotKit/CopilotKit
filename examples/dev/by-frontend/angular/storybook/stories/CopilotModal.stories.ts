import { ChangeDetectionStrategy, Component } from "@angular/core";
import { HttpAgent } from "@ag-ui/client";
import type { Meta, StoryObj } from "@storybook/angular";
import { applicationConfig, moduleMetadata } from "@storybook/angular";
import {
  CopilotPopup,
  CopilotSidebar,
  provideCopilotKit,
} from "@copilotkit/angular";

@Component({
  selector: "storybook-chat-placeholder",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      aria-label="Copilot conversation"
      style="display: grid; gap: 1rem; padding: 1rem"
    >
      <p>{{ prompt }}</p>
      <label>
        Message
        <textarea rows="4"></textarea>
      </label>
      <button type="button">Send message</button>
    </main>
  `,
})
class ChatPlaceholder {
  protected readonly prompt = "Ask Copilot about this page.";
}

const meta: Meta = {
  title: "UI/Modal chat surfaces",
  decorators: [
    moduleMetadata({
      imports: [CopilotPopup, CopilotSidebar],
    }),
  ],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj;

export const Popup: Story = {
  render: () => ({
    template: `
      <copilot-popup
        title="Copilot popup"
        [chatComponent]="chatComponent"
      />
    `,
    props: { chatComponent: ChatPlaceholder },
  }),
};

export const OverlaySidebar: Story = {
  render: () => ({
    template: `
      <copilot-sidebar
        title="Copilot sidebar"
        mode="overlay"
        [chatComponent]="chatComponent"
      />
    `,
    props: { chatComponent: ChatPlaceholder },
  }),
};

export const DockedSidebar: Story = {
  render: () => ({
    template: `
      <copilot-sidebar
        title="Copilot sidebar"
        mode="docked"
        [chatComponent]="chatComponent"
      />
    `,
    props: { chatComponent: ChatPlaceholder },
  }),
};

// The surfaces with the real chat inside, as in React's CopilotPopup and
// CopilotSidebar stories. The agent is never called: the welcome screen
// sends nothing.
const withChatAgent = applicationConfig({
  providers: [
    provideCopilotKit({
      selfManagedAgents: {
        default: new HttpAgent({ url: "http://localhost/storybook-agent" }),
      },
    }),
  ],
});
export const PopupWithChat: Story = {
  decorators: [withChatAgent],
  render: () => ({ template: `<copilot-popup title="CopilotKit Chat" />` }),
};

export const SidebarWithChat: Story = {
  decorators: [withChatAgent],
  render: () => ({
    template: `<copilot-sidebar title="CopilotKit Chat" mode="docked" />`,
  }),
};
