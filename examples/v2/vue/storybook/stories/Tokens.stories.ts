import type { Meta, StoryObj } from "@storybook/vue3-vite";
import TokensPage from "./support/TokensPage.vue";

const meta = {
  title: "Foundations/Tokens",
  component: TokensPage,
  parameters: {
    layout: "fullscreen",
    copilotkit: false,
  },
} satisfies Meta<typeof TokensPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tokens: Story = {};
