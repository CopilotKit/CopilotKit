import type { Meta, StoryObj } from "@storybook/angular";
import { applicationConfig, moduleMetadata } from "@storybook/angular";
import type {
  AssistantMessage,
  CopilotChatToolCallDisplay,
  Message,
} from "@copilotkit/angular";
import { CopilotChatMessageView, provideCopilotKit } from "@copilotkit/angular";

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

const say = (id: string, content: string): AssistantMessage => ({
  id,
  role: "assistant",
  content,
});

/** One call per message, then its result, like a streamed run. */
const call = (
  id: string,
  name: string,
  args: Record<string, unknown>,
  result: string,
  error?: string,
): Message[] => [
  {
    id: `${id}-message`,
    role: "assistant",
    content: "",
    toolCalls: [toolCall(id, name, args)],
  },
  {
    id: `${id}-result`,
    role: "tool",
    toolCallId: id,
    content: result,
    ...(error ? { error } : {}),
  },
];

/** React's "debug" scripted run (ToolCallDisplay.stories.tsx), finished. */
const debugRun: Message[] = [
  {
    id: "question",
    role: "user",
    content: "Why is the checkout build failing on main?",
  },
  say("debug-1", "I'll start with the failing job."),
  ...call(
    "debug-c1",
    "run_command",
    { command: "gh run view 8412 --log-failed" },
    "checkout.test.ts › creates a payment intent\n  Error: STRIPE_KEY is not defined",
  ),
  ...call(
    "debug-c2",
    "read_file",
    { path: "src/checkout/stripe.ts" },
    "import Stripe from 'stripe';\nexport const stripe = new Stripe(process.env.STRIPE_KEY!);",
  ),
  ...call(
    "debug-c3",
    "run_command",
    { command: "git log -3 --oneline -- src/checkout" },
    "a41c2e9 move Stripe client to a server-only module\n9f03b1d add checkout analytics\n51ce8aa bump stripe to 17.4",
  ),
  say(
    "debug-2",
    "The Stripe client now reads `STRIPE_KEY` as soon as it's imported. Checking where that variable is set.",
  ),
  ...call(
    "debug-c4",
    "search_code",
    { query: "STRIPE_KEY" },
    "3 matches: .env.example, src/checkout/stripe.ts, turbo.json",
  ),
  ...call(
    "debug-c5",
    "run_command",
    { command: "vercel env ls" },
    "Error: No project linked. Run `vercel link` first.",
    "No project linked",
  ),
  ...call(
    "debug-c6",
    "run_command",
    { command: "vercel env ls --cwd apps/web" },
    "STRIPE_KEY               Production\nSTRIPE_PUBLISHABLE_KEY   Production, Preview",
  ),
  ...call(
    "debug-c7",
    "read_file",
    { path: "turbo.json" },
    '{\n  "globalEnv": ["STRIPE_PUBLISHABLE_KEY"]\n}',
  ),
  say(
    "debug-answer",
    "The build fails because `STRIPE_KEY` never reaches the test run.\n\n- `a41c2e9` moved the Stripe client into a module that reads `STRIPE_KEY` when it's imported, so the checkout tests now need it.\n- `STRIPE_KEY` is only set for **Production** in Vercel, and `turbo.json` doesn't pass it through `globalEnv`, so CI runs without it.\n\nAdd `STRIPE_KEY` to `globalEnv` and set a test key for Preview. Want me to open a PR?",
  ),
];

/** The same run while the last burst of calls is still going. */
const runningRun: Message[] = debugRun
  .slice(
    0,
    debugRun.findIndex((message) => message.id === "debug-c6-result"),
  )
  .concat(
    call("debug-c7", "read_file", { path: "turbo.json" }, "").slice(0, 1),
  );

interface ToolCallDisplayArgs {
  toolCallDisplay: CopilotChatToolCallDisplay;
  running: boolean;
}

/**
 * `toolCallDisplay` on `CopilotChatMessageView` (and `CopilotChat`) decides how
 * tool calls show. The built-in card (`defaultToolRendering: true`) groups
 * calls made in a row.
 */
const meta: Meta<ToolCallDisplayArgs> = {
  title: "UI/Tool call display",
  decorators: [
    applicationConfig({
      providers: [provideCopilotKit({ defaultToolRendering: true })],
    }),
    moduleMetadata({ imports: [CopilotChatMessageView] }),
  ],
  parameters: { layout: "fullscreen" },
  args: { toolCallDisplay: "grouped", running: false },
  argTypes: {
    toolCallDisplay: {
      control: "inline-radio",
      options: ["grouped", "line", "stacked", "separate"],
    },
    running: { control: "boolean" },
  },
  render: (args) => ({
    props: {
      ...args,
      messages: args.running ? runningRun : debugRun,
    },
    template: `
      <div style="margin-inline: auto; width: 100%; max-width: 42rem; padding: 2.5rem 1.5rem;">
        <copilot-chat-message-view
          [messages]="messages"
          [isLoading]="running"
          [toolCallDisplay]="toolCallDisplay"
        />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<ToolCallDisplayArgs>;

/** The default: calls made in a row share one card that opens to a row per call. */
export const Grouped: Story = {};

/** A quiet line of text, the sibling of the reasoning message's "Thought for 4 seconds". */
export const Line: Story = { args: { toolCallDisplay: "line" } };

/** The latest call on top of a stack of the earlier ones; click to fan it out. */
export const Stacked: Story = { args: { toolCallDisplay: "stacked" } };

/** Every call its own card, as before grouping. */
export const Separate: Story = { args: { toolCallDisplay: "separate" } };

/** The last group names the call that is running. */
export const Running: Story = { args: { running: true } };
