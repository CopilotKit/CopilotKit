import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotDefaultToolRenderer } from "@copilotkit/angular";
import type { AngularToolCall } from "@copilotkit/angular";
import { withMessageColumn } from "./support/layouts";

/**
 * CopilotKit's built-in tool-call card (the Angular counterpart of React's
 * `WildcardToolCallRender`), used for tools without an app renderer when
 * `defaultToolRendering` is on.
 */
const args = { query: "Q3 launch", filters: ["open", "blocking"] };

const meta: Meta = {
  title: "UI/CopilotDefaultToolRenderer",
  component: CopilotDefaultToolRenderer,
  decorators: [
    moduleMetadata({ imports: [CopilotDefaultToolRenderer] }),
    withMessageColumn,
  ],
  render: (storyArgs) => ({
    props: storyArgs,
    template: `
      <div data-copilotkit>
        <copilot-default-tool-renderer [toolCall]="toolCall" />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj;

const call = (toolCall: Partial<AngularToolCall>): AngularToolCall =>
  ({
    name: "searchTasks",
    args,
    result: undefined,
    ...toolCall,
  }) as AngularToolCall;

/** Still running: spinner, with the name and status shimmering. */
export const InProgress: Story = {
  args: { toolCall: call({ status: "executing" }) },
};

export const Complete: Story = {
  args: {
    toolCall: call({
      status: "complete",
      result: "Found 14 open tasks, 3 of them blocking.",
    }),
  },
};

/** Expanded to show the arguments and result. */
export const Expanded: Story = {
  ...Complete,
  play: async ({ canvasElement }) => {
    await new Promise<void>((resolve) => {
      const find = (): void => {
        const toggle = canvasElement.querySelector<HTMLButtonElement>(
          '[data-testid="copilot-tool-render"] button',
        );
        if (!toggle) {
          requestAnimationFrame(find);
          return;
        }
        toggle.click();
        resolve();
      };
      find();
    });
  },
};

/** A tool that returned an error message as its result, expanded. */
export const ErrorResult: Story = {
  args: {
    toolCall: call({
      status: "complete",
      result: "Error: task tracker returned 503 (service unavailable)",
    }),
  },
  play: Expanded.play,
};
