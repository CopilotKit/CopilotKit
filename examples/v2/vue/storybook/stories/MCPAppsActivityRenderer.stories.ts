import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { computed } from "vue";
import { MCPAppsActivityRenderer, MCPAppsActivityType } from "@copilotkit/vue";
import type { MCPAppsActivityContent } from "@copilotkit/vue";
import { withMessageColumn } from "./support/layouts";
import { StoryAgent } from "./support/story-agent";
import type { StoryAgentOptions } from "./support/story-agent";

/**
 * Renders an MCP App (an MCP server's `ui://` widget) in a sandboxed iframe.
 * The renderer fetches the widget through the agent (`resources/read` proxied
 * to the MCP server); here a local StoryAgent answers that request with inline
 * HTML, so the full sandbox + AppBridge path runs offline.
 */
const resourceUri = "ui://weather/forecast";

/** Widget HTML as an MCP server would serve it. It reports its own height. */
const forecastWidget = `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; color: #18181b; }
  .card { border: 1px solid #e4e4e7; border-radius: 14px; padding: 16px; background: #fff; }
  .top { display: flex; justify-content: space-between; align-items: baseline; }
  .city { font-weight: 600; }
  .muted { color: #71717a; font-size: 12px; }
  .temp { font-size: 40px; font-weight: 600; letter-spacing: -0.02em; margin: 8px 0 12px; }
  .days { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .day { background: #f4f4f5; border-radius: 10px; padding: 8px; text-align: center; }
  .day b { display: block; font-size: 13px; }
</style></head>
<body><div class="card">
  <div class="top"><span class="city">San Francisco</span><span class="muted">Weather MCP · live</span></div>
  <div class="temp">68°F <span class="muted">Partly cloudy</span></div>
  <div class="days">
    <div class="day"><span class="muted">Fri</span><b>69°</b></div>
    <div class="day"><span class="muted">Sat</span><b>72°</b></div>
    <div class="day"><span class="muted">Sun</span><b>66°</b></div>
    <div class="day"><span class="muted">Mon</span><b>64°</b></div>
    <div class="day"><span class="muted">Tue</span><b>67°</b></div>
  </div>
</div>
<script>
  const report = () => parent.postMessage({
    jsonrpc: "2.0",
    method: "ui/notifications/size-changed",
    params: { height: document.documentElement.scrollHeight },
  }, "*");
  addEventListener("load", report);
  new ResizeObserver(report).observe(document.body);
</script>
</body></html>`;

const content: MCPAppsActivityContent = {
  resourceUri,
  serverHash: "storybook-weather",
  toolInput: { city: "San Francisco" },
  result: {
    content: [
      { type: "text", text: "68°F and partly cloudy in San Francisco." },
    ],
  },
};

interface RendererArgs {
  /** StoryAgent options, or `null` to render without an agent. */
  agent?: StoryAgentOptions | null;
}

const meta = {
  title: "UI/MCPAppsActivityRenderer",
  decorators: [withMessageColumn],
  parameters: {
    layout: "fullscreen",
  },
  render: (args) => ({
    components: { MCPAppsActivityRenderer },
    setup() {
      const agent = computed(() =>
        args.agent === null ? undefined : new StoryAgent(args.agent),
      );
      const message = { id: "mcp-activity", role: "activity", content };
      return { MCPAppsActivityType, agent, content, message };
    },
    template: `
      <MCPAppsActivityRenderer
        :activity-type="MCPAppsActivityType"
        :content="content"
        :message="message"
        :agent="agent"
      />
    `,
  }),
} satisfies Meta<RendererArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The widget loaded in its sandbox and sized to its content. */
export const Default: Story = {
  args: {
    agent: {
      mcpResources: {
        [resourceUri]: { mimeType: "text/html", text: forecastWidget },
      },
    },
  },
};

/** Waiting on the MCP server for the widget resource. */
export const Loading: Story = {
  args: {
    agent: { mcpLatencyMs: Infinity },
  },
};

/**
 * The error state, reached here by rendering without an agent to proxy
 * through. (A failed resource fetch shows the same state.)
 */
export const NoAgent: Story = {
  args: {
    agent: null,
  },
};
