import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotChatSuggestionPill } from "@copilotkit/angular";
import { withCenteredStage } from "./support/layouts";

const meta: Meta<CopilotChatSuggestionPill> = {
  title: "UI/CopilotChatSuggestionPill",
  component: CopilotChatSuggestionPill,
  decorators: [
    moduleMetadata({ imports: [CopilotChatSuggestionPill] }),
    withCenteredStage,
  ],
  args: {
    title: "Summarize this thread",
    isLoading: false,
    disabled: false,
    appearance: "pill",
    description: undefined,
  },
  argTypes: {
    appearance: { control: "inline-radio", options: ["pill", "card"] },
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="display: flex; justify-content: center">
        <copilot-chat-suggestion-pill
          [title]="title"
          [isLoading]="isLoading"
          [disabled]="disabled"
          [appearance]="appearance"
          [description]="description"
          [style.width]="appearance === 'card' ? '20rem' : null"
        />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotChatSuggestionPill>;

export const Default: Story = {};

/** Shown while a dynamic suggestion is still being generated. */
export const Loading: Story = {
  args: { title: "Generating…", isLoading: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** The welcome-screen card: title as header, description as body. */
export const Card: Story = {
  args: {
    appearance: "card",
    title: "Plan a launch",
    description: "Turn the Q3 goals into a week-by-week launch checklist",
  },
};

export const CardLoading: Story = {
  args: { ...Card.args, isLoading: true },
};
