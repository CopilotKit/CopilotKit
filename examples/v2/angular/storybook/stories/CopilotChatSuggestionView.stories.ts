import type { Meta, StoryObj } from "@storybook/angular";
import { componentWrapperDecorator, moduleMetadata } from "@storybook/angular";
import { CopilotChatSuggestionView } from "@copilotkit/angular";
import type { Suggestion } from "@copilotkit/angular";
import { manySuggestions, starterSuggestions } from "./support/fixtures";
import { withCenteredStage } from "./support/layouts";

const suggestions: Suggestion[] = [
  {
    title: "Summarize this thread",
    message: "Summarize this thread in three bullet points.",
    isLoading: false,
  },
  {
    title: "Draft a reply",
    message: "Draft a friendly reply.",
    isLoading: false,
  },
  {
    title: "Create action items",
    message: "Turn this into action items.",
    isLoading: false,
  },
];

const meta: Meta<CopilotChatSuggestionView> = {
  title: "UI/CopilotChatSuggestionView",
  component: CopilotChatSuggestionView,
  decorators: [
    moduleMetadata({ imports: [CopilotChatSuggestionView] }),
    withCenteredStage,
  ],
  args: { suggestions, appearance: "pills" },
  argTypes: {
    appearance: { control: "inline-radio", options: ["pills", "cards"] },
  },
  render: (args) => ({
    props: {
      ...args,
      onSelect: (event: { suggestion: Suggestion; index: number }) =>
        console.info("[Storybook] selectSuggestion", event.suggestion.title),
    },
    template: `
      <copilot-chat-suggestion-view
        [suggestions]="suggestions"
        [appearance]="appearance"
        [inputClass]="inputClass"
        (selectSuggestion)="onSelect($event)"
      />
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotChatSuggestionView>;

export const Default: Story = {};

/** One suggestion is still being generated. */
export const LoadingSecond: Story = {
  args: {
    suggestions: suggestions.map((s, i) =>
      i === 1 ? { ...s, title: "Generating…", isLoading: true } : s,
    ),
  },
};

/** Suggestions can carry their own class for one-off emphasis. */
export const CustomSuggestionClass: Story = {
  args: {
    suggestions: suggestions.map((s, i) =>
      i === 0 ? { ...s, className: "story-highlight-pill" } : s,
    ),
  },
};

/** Welcome-screen cards: the title is the header, the message the body. */
export const Cards: Story = {
  args: { appearance: "cards", suggestions: starterSuggestions },
  decorators: [
    componentWrapperDecorator(
      (story) =>
        `<div class="story-container" style="width: 720px">${story}</div>`,
    ),
  ],
};

/** Cards stack in one column in narrow chats such as the popup or sidebar. */
export const CardsNarrow: Story = {
  args: {
    appearance: "cards",
    suggestions: starterSuggestions.map((s, i) =>
      i === 1 ? { ...s, isLoading: true } : s,
    ),
  },
  decorators: [
    componentWrapperDecorator(
      (story) =>
        `<div class="story-container" style="width: 360px">${story}</div>`,
    ),
  ],
};

/** Pills overflowing a narrow width: the row scrolls and its edge fades. */
export const Overflowing: Story = {
  args: { suggestions: manySuggestions },
  decorators: [
    componentWrapperDecorator(
      (story) => `<div style="width: 420px; margin: 0 auto">${story}</div>`,
    ),
  ],
};
