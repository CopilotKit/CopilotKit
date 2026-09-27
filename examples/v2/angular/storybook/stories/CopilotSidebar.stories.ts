import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotSidebar } from "@copilotkit/angular";
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
 * `<copilot-sidebar>` next to (docked) or over (overlay) a mock host page. The
 * sidebar hosts a real `<copilot-chat>` backed by the in-memory Storybook
 * agent, so you can send a message and watch the reply stream in.
 */
const meta: Meta<CopilotSidebar> = {
  title: "UI/CopilotSidebar",
  component: CopilotSidebar,
  decorators: [moduleMetadata({ imports: [CopilotSidebar, StoryHostPage] })],
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    mode: "docked",
    position: "right",
    width: 480,
    title: "CopilotKit Chat",
    clickOutsideToClose: false,
    threadsDrawer: false,
    headerComponent: undefined,
  },
  argTypes: {
    mode: { control: "inline-radio", options: ["docked", "overlay"] },
    position: { control: "inline-radio", options: ["left", "right"] },
  },
  render: (args) => ({
    props: args,
    template: `
      <story-host-page>
        <copilot-sidebar
          [open]="open"
          [mode]="mode"
          [position]="position"
          [width]="width"
          [title]="title"
          [clickOutsideToClose]="clickOutsideToClose"
          [threadsDrawer]="threadsDrawer"
          [headerComponent]="headerComponent"
        />
      </story-host-page>
    `,
  }),
};

export default meta;
type Story = StoryObj<CopilotSidebar>;

/** Docked: the host page shrinks to make room. */
export const Default: Story = {};

/** Overlay: a modal sheet with a backdrop over the host page. */
export const Overlay: Story = {
  args: { mode: "overlay", clickOutsideToClose: true },
};

export const LeftPosition: Story = {
  args: { position: "left" },
  parameters: {
    copilotkit: {
      agent: { messages: conversation },
    } satisfies CopilotKitStoryParameters,
  },
};

/** Only the launcher button; click it to open the sidebar. */
export const Closed: Story = {
  args: { open: false },
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
 * list over the sidebar. Thread data is pinned (see support/threads-drawer.ts).
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
