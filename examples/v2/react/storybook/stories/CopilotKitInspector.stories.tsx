import type { Meta, StoryObj } from "@storybook/react";
import { CopilotKitInspector } from "@copilotkit/react-core/v2";

const meta: Meta<typeof CopilotKitInspector> = {
  title: "Components/CopilotKit Inspector",
  component: CopilotKitInspector,
};

export default meta;

type Story = StoryObj<typeof CopilotKitInspector>;

export const Default: Story = {
  args: {},
};
