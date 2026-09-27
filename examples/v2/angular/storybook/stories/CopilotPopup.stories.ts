import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotPopup } from "@copilotkit/angular";
import type { CopilotKitStoryParameters } from "../.storybook/preview";
import {
  conversation,
  starterSuggestions,
  suggestionsConfig,
} from "./support/fixtures";
import { StoryHostPage } from "./support/host-page";
import { StoryModalHeader } from "./support/story-header";
import { pinDrawer, pinnedThreads } from "./support/threads-drawer";

/**
 * `<copilot-popup>` over a mock host page. The popup hosts a real
 * `<copilot-chat>` backed by the in-memory Storybook agent, so you can send a
 * message and watch the reply stream in.
 */
const meta: Meta<CopilotPopup> = {
  title: "UI/CopilotPopup",
  component: CopilotPopup,
  decorators: [moduleMetadata({ imports: [CopilotPopup, StoryHostPage] })],
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    title: "CopilotKit Chat",
    width: 420,
    height: 560,
    clickOutsideToClose: false,
    threadsDrawer: false,
    headerComponent: undefined,
  },
  render: (args) => ({
    props: args,
    template: `
      <story-host-page>
        <copilot-popup
          [open]="open"
          [title]="title"
          [width]="width"
          [height]="height"
          [clickOutsideToClose]="clickOutsideToClose"
          [threadsDrawer]="threadsDrawer"
          [headerComponent]="headerComponent"
        />
      </story-host-page>
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotPopup>;

export const Default: Story = {};

/** Only the launcher button; click it to open the popup. */
export const Closed: Story = {
  args: { open: false },
};

export const CustomSize: Story = {
  args: { width: 360, height: 480 },
  parameters: {
    copilotkit: {
      agent: { messages: conversation },
    } satisfies CopilotKitStoryParameters,
  },
};

/**
 * Welcome screen with suggestion cards: greeting and cards centered together
 * (one column at this width), input docked at the bottom.
 */
export const WelcomeScreen: Story = {
  parameters: {
    copilotkit: {
      config: { suggestionsConfig: suggestionsConfig(starterSuggestions) },
    } satisfies CopilotKitStoryParameters,
  },
};

/** Opens mid-conversation; new replies stream in below. */
export const WithConversation: Story = {
  parameters: {
    copilotkit: {
      agent: { messages: conversation },
    } satisfies CopilotKitStoryParameters,
  },
};

/**
 * `threadsDrawer`: a launcher at the start of the header opens the thread
 * list over the popup. Thread data is pinned (see support/threads-drawer.ts).
 */
export const WithThreadsDrawer: Story = {
  args: { threadsDrawer: true },
  parameters: WithConversation.parameters,
  play: async ({ canvasElement }) => {
    await pinDrawer(canvasElement, pinnedThreads);
  },
};

/** The drawer open over the chat, with the active thread highlighted. */
export const WithThreadsDrawerOpen: Story = {
  ...WithThreadsDrawer,
  play: async ({ canvasElement }) => {
    await pinDrawer(canvasElement, pinnedThreads);
    canvasElement
      .querySelector<HTMLButtonElement>(
        '[data-testid="copilot-threads-drawer-launcher"]',
      )
      ?.click();
  },
};

/**
 * `headerComponent` replaces the default title with your own header. The
 * component class is bound in `render` rather than passed as an arg:
 * a class passed as an arg reaches the component as undefined.
 */
export const CustomHeader: Story = {
  render: (args, context) => {
    const story = meta.render!(args, context);
    return {
      ...story,
      props: { ...story.props, headerComponent: StoryModalHeader },
    };
  },
};
