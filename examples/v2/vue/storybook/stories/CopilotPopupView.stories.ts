import type { Message } from "@ag-ui/core";
import type { Suggestion } from "@copilotkit/core";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotPopupView } from "@copilotkit/vue";
import CopilotStoryLayout from "./CopilotStoryLayout.vue";

// Same conversation and suggestions as the React story fixtures, so the two
// storybooks can be compared side by side.
const conversation: Message[] = [
  {
    id: "user-1",
    role: "user",
    content: "Hello! Can you help me understand how React hooks work?",
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: `React hooks are functions that let you use state and other React features in functional components. Here are the most common ones:

- **useState** - Manages local state
- **useEffect** - Handles side effects
- **useContext** - Accesses context values
- **useCallback** - Memoizes functions
- **useMemo** - Memoizes values

Would you like me to explain any of these in detail?`,
  },
];

const starterSuggestions: Suggestion[] = [
  {
    title: "Plan a launch",
    message: "Turn the Q3 goals into a week-by-week launch checklist",
    isLoading: false,
  },
  {
    title: "Summarize a thread",
    message: "Pull the decisions and owners out of a long discussion",
    isLoading: false,
  },
  {
    title: "Draft a reply",
    message: "Write a friendly follow-up to yesterday's design review",
    isLoading: false,
  },
  {
    title: "Explain a concept",
    message: "Walk me through how React hooks manage component state",
    isLoading: false,
  },
];

const meta = {
  title: "UI/CopilotPopupView",
  component: CopilotPopupView,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    messages: conversation,
    clickOutsideToClose: false,
  },
  render: (args) => ({
    components: { CopilotStoryLayout, CopilotPopupView },
    setup() {
      return { args };
    },
    template: `
      <CopilotStoryLayout>
        <CopilotPopupView v-bind="args" />
      </CopilotStoryLayout>
    `,
  }),
} satisfies Meta<typeof CopilotPopupView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No messages: the popup's welcome screen. */
export const WelcomeScreen: Story = {
  args: {
    messages: [],
    suggestions: starterSuggestions,
  },
};
