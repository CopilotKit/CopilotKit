import type { Meta, StoryObj } from "@storybook/angular";
import { ThreadListComponent } from "@copilotkit/web-inspector-angular";

const meta: Meta<ThreadListComponent> = {
  title: "Inspector/ThreadList",
  component: ThreadListComponent,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<ThreadListComponent>;

// Figma canvas background: 3 blurred ellipses over a transparent container.
// Ellipse values from Figma (container 1724×1157):
//   1: #FFAC4D op:0.24  top:588  left:55    blur:240
//   2: #757CF2 op:0.12  top:0    left:-106  blur:240  (no top in Figma — defaulting to 0)
//   3: #FFAC4D op:0.24  top:117  left:1048  blur:240
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

const SAMPLE_THREADS = [
  {
    id: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
    name: "Dog & Pony Show",
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    agentId: "research-agent",
    createdById: "user-1",
  },
  {
    id: "a1b2c3d4-0000-0000-0000-111111111111",
    name: "Tech Talk",
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    agentId: "research-agent",
    createdById: "user-1",
  },
  {
    id: "b2c3d4e5-0000-0000-0000-222222222222",
    name: null,
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    agentId: "chat-agent",
    createdById: "user-2",
  },
];

export const Default: Story = {
  render: () => ({
    props: { threads: SAMPLE_THREADS },
    template: BG_TEMPLATE(
      `<cpk-thread-list [threads]="threads"></cpk-thread-list>`,
    ),
  }),
};

export const Empty: Story = {
  render: () => ({
    template: BG_TEMPLATE(`<cpk-thread-list [threads]="[]"></cpk-thread-list>`),
  }),
};
