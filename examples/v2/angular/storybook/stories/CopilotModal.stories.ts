import { ChangeDetectionStrategy, Component } from "@angular/core";
import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotPopup, CopilotSidebar } from "@copilotkit/angular";

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
