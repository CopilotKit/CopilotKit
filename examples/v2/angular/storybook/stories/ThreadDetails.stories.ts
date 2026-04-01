import type { Meta, StoryObj } from "@storybook/angular";
import { ThreadDetailsComponent } from "@copilotkit/web-inspector-angular";

const ELLIPSE = (color: string, opacity: number, top: number, left: number) =>
  `position:absolute;width:570px;height:569px;border-radius:50%;` +
  `top:${top}px;left:${left}px;opacity:${opacity};background:${color};filter:blur(240px)`;

const BG_TEMPLATE = (innerTemplate: string) => `
  <div style="position:relative;min-height:600px;padding:40px;overflow:hidden;box-sizing:border-box;">
    <div style="${ELLIPSE("#FFAC4D", 0.5, 588, 55)}"></div>
    <div style="${ELLIPSE("#757CF2", 0.5, 0, -106)}"></div>
    <div style="${ELLIPSE("#FFAC4D", 0.5, 117, 1048)}"></div>
    <div style="position:relative;z-index:1;">${innerTemplate}</div>
  </div>
`;

const meta: Meta<ThreadDetailsComponent> = {
  title: "Inspector/ThreadDetails",
  component: ThreadDetailsComponent,
  parameters: {
    layout: "fullscreen",
  },
};
export default meta;
type Story = StoryObj<ThreadDetailsComponent>;

export const Default: Story = {
  render: (args) => ({
    props: args,
    template: BG_TEMPLATE(
      `<cpk-thread-details [threadId]="threadId"></cpk-thread-details>`,
    ),
  }),
  args: {
    threadId: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
  },
};

export const AgentStateTab: Story = {
  render: (args) => ({
    props: args,
    template: BG_TEMPLATE(
      `<cpk-thread-details [threadId]="threadId"></cpk-thread-details>`,
    ),
  }),
  args: {
    threadId: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>(
      ".cpk-td__tab:nth-child(2)",
    );
    button?.click();
  },
};

export const AguiEventsTab: Story = {
  render: (args) => ({
    props: args,
    template: BG_TEMPLATE(
      `<cpk-thread-details [threadId]="threadId"></cpk-thread-details>`,
    ),
  }),
  args: {
    threadId: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>(
      ".cpk-td__tab:nth-child(3)",
    );
    button?.click();
  },
};
