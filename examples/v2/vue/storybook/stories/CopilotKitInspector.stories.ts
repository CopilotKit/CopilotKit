import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotKitInspector } from "@copilotkitnext/vue";

const meta = {
  title: "Components/CopilotKit Inspector",
  component: CopilotKitInspector,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CopilotKitInspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
