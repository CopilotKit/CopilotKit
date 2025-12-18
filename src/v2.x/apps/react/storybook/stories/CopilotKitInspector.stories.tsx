import type { Meta, StoryObj } from "@storybook/react";
import { CopilotKitInspector } from "@copilotkitnext/react";

const meta: Meta<typeof CopilotKitInspector> = {
  title: "Components/CopilotKit Inspector",
  component: CopilotKitInspector,
};

export default meta;

type Story = StoryObj<typeof CopilotKitInspector>;

export const Default: Story = {
  args: {},
};
