import type { Meta, StoryObj } from "@storybook/angular";
import { ThreadDetailsComponent } from "@copilotkit/web-inspector-angular";
import type {
  InspectorThreadMeta,
  ConversationItem,
} from "@copilotkit/web-inspector-angular";

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

const SAMPLE_THREAD: InspectorThreadMeta = {
  id: "c2f262b8-4b3e-4d9e-9d7c-8348c8cc0f67",
  name: "Tech Talk",
  createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  agentId: "research-agent",
  createdById: "b2d34f00-5a2c-4d9e-9d7c-8348c8cc0f67",
};

const SAMPLE_CONVERSATION: ConversationItem[] = [
  {
    id: "item-1",
    type: "user",
    content:
      "Can you help me explore the future of AI? How do you think it will impact society?",
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  },
  {
    id: "item-2",
    type: "tool_call",
    toolName: "web_search",
    toolCallId: "call_01J9Z4X8W2Y7TQ",
    arguments: {
      query: "Pulumi enterprise adoption 2025 developer sentiment",
      recency_days: 90,
      domains: ["reddit.com", "github.com", "news.ycombinator.com"],
      max_results: 5,
    },
    result: {
      id: "result_01J9Z4X8W2Y7TQ",
      type: "tool_result",
      tool_name: "web_search",
      status: "success",
      latency_ms: 842,
      results: [
        {
          title: "Pulumi vs Terraform in 2025: Real-World Enterprise Feedback",
          url: "https://news.ycombinator.com/item",
        },
      ],
    },
    createdAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  },
  {
    id: "item-3",
    type: "tool_call",
    toolName: "image_search",
    toolCallId: "call_02",
    arguments: { query: "AI society impact visualization" },
    result: { status: "success", results: [] },
    createdAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    groupId: "group-1",
  },
  {
    id: "item-4",
    type: "tool_call",
    toolName: "video_search",
    toolCallId: "call_03",
    arguments: { query: "future of AI 2025" },
    result: { status: "success", results: [] },
    createdAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    groupId: "group-1",
  },
  {
    id: "item-5",
    type: "tool_call",
    toolName: "news_search",
    toolCallId: "call_04",
    arguments: { query: "AI news 2025" },
    result: { status: "success", results: [] },
    createdAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
    groupId: "group-1",
  },
  {
    id: "item-6",
    type: "reasoning",
    duration: "7m and 36s",
    createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    id: "item-7",
    type: "state_update",
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    id: "item-8",
    type: "agent_responded",
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  },
  {
    id: "item-9",
    type: "assistant",
    content:
      'AI will not be a single "event." It will be a layered shift across cognition, labor, institutions, and culture. The useful way to think about it is not "Will AI replace X?" but "What happens when intelligence becomes cheap, abundant, and embedded in everything?"',
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  },
];

const meta: Meta<ThreadDetailsComponent> = {
  title: "Inspector/ThreadDetails",
  component: ThreadDetailsComponent,
  parameters: {
    layout: "fullscreen",
  },
};
export default meta;
type Story = StoryObj<ThreadDetailsComponent>;

const DETAIL_TEMPLATE = BG_TEMPLATE(
  `<cpk-thread-details
    [threadId]="threadId"
    [thread]="thread"
    [conversationOverride]="conversationOverride"
    [initialTab]="initialTab"
  ></cpk-thread-details>`,
);

const BASE_ARGS = {
  threadId: SAMPLE_THREAD.id,
  thread: SAMPLE_THREAD,
  conversationOverride: SAMPLE_CONVERSATION,
};

export const ConversationTab: Story = {
  render: (args) => ({ props: args, template: DETAIL_TEMPLATE }),
  args: { ...BASE_ARGS, initialTab: "conversation" },
};

export const AgentStateTab: Story = {
  render: (args) => ({ props: args, template: DETAIL_TEMPLATE }),
  args: { ...BASE_ARGS, initialTab: "agent-state" },
};

export const AguiEventsTab: Story = {
  render: (args) => ({ props: args, template: DETAIL_TEMPLATE }),
  args: { ...BASE_ARGS, initialTab: "ag-ui-events" },
};
