import type { Meta, StoryObj } from "@storybook/angular";
import { ThreadDetailsComponent } from "@copilotkitnext/web-inspector-angular";

const meta: Meta<ThreadDetailsComponent> = {
  title: "Inspector/ThreadDetails",
  component: ThreadDetailsComponent,
  parameters: {
    layout: "fullscreen",
  },
};
export default meta;
type Story = StoryObj<ThreadDetailsComponent>;

export const Default: Story = {
  args: {
    threadId: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
  },
};

export const AgentStateTab: Story = {
  args: {
    threadId: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>(
      ".cpk-td__tab:nth-child(2)"
    );
    button?.click();
  },
};

export const AguiEventsTab: Story = {
  args: {
    threadId: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>(
      ".cpk-td__tab:nth-child(3)"
    );
    button?.click();
  },
};
