import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { defineComponent, h, ref, watch } from "vue";
import type { PropType } from "vue";
import type { Message } from "@ag-ui/core";
import {
  CopilotChatConfigurationProvider,
  CopilotChatMessageView,
  CopilotKitProvider,
  useDefaultRenderTool,
} from "@copilotkit/vue";
import type { CopilotChatToolCallDisplay } from "@copilotkit/vue";

/**
 * React's "debug" scripted run (examples/v2/react/storybook/stories/support/
 * scripted-run.ts), as the messages a chat holds: each call is its own
 * message, followed by its result.
 */
type Step =
  | { kind: "text"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      result: string;
      error?: string;
    };

const steps: Step[] = [
  { kind: "text", id: "debug-1", text: "I'll start with the failing job." },
  {
    kind: "tool",
    id: "debug-c1",
    name: "run_command",
    args: { command: "gh run view 8412 --log-failed" },
    result:
      "checkout.test.ts › creates a payment intent\n  Error: STRIPE_KEY is not defined",
  },
  {
    kind: "tool",
    id: "debug-c2",
    name: "read_file",
    args: { path: "src/checkout/stripe.ts" },
    result:
      "import Stripe from 'stripe';\nexport const stripe = new Stripe(process.env.STRIPE_KEY!);",
  },
  {
    kind: "tool",
    id: "debug-c3",
    name: "run_command",
    args: { command: "git log -3 --oneline -- src/checkout" },
    result:
      "a41c2e9 move Stripe client to a server-only module\n9f03b1d add checkout analytics\n51ce8aa bump stripe to 17.4",
  },
  {
    kind: "text",
    id: "debug-2",
    text: "The Stripe client now reads `STRIPE_KEY` as soon as it's imported. Checking where that variable is set.",
  },
  {
    kind: "tool",
    id: "debug-c4",
    name: "search_code",
    args: { query: "STRIPE_KEY" },
    result: "3 matches: .env.example, src/checkout/stripe.ts, turbo.json",
  },
  {
    kind: "tool",
    id: "debug-c5",
    name: "run_command",
    args: { command: "vercel env ls" },
    result: "Error: No project linked. Run `vercel link` first.",
    error: "No project linked",
  },
  {
    kind: "tool",
    id: "debug-c6",
    name: "run_command",
    args: { command: "vercel env ls --cwd apps/web" },
    result:
      "STRIPE_KEY               Production\nSTRIPE_PUBLISHABLE_KEY   Production, Preview",
  },
  {
    kind: "tool",
    id: "debug-c7",
    name: "read_file",
    args: { path: "turbo.json" },
    result: '{\n  "globalEnv": ["STRIPE_PUBLISHABLE_KEY"]\n}',
  },
  {
    kind: "text",
    id: "debug-answer",
    text: "The build fails because `STRIPE_KEY` never reaches the test run.\n\n- `a41c2e9` moved the Stripe client into a module that reads `STRIPE_KEY` when it's imported, so the checkout tests now need it.\n- `STRIPE_KEY` is only set for **Production** in Vercel, and `turbo.json` doesn't pass it through `globalEnv`, so CI runs without it.\n\nAdd `STRIPE_KEY` to `globalEnv` and set a test key for Preview. Want me to open a PR?",
  },
];

/**
 * The messages after the first `count` steps. With `running`, the last call
 * has no result yet.
 */
function messagesAfter(count: number, running: boolean): Message[] {
  const messages: Message[] = [
    {
      id: "question",
      role: "user",
      content: "Why is the checkout build failing on main?",
    },
  ];
  steps.slice(0, count).forEach((step, index) => {
    if (step.kind === "text") {
      messages.push({ id: step.id, role: "assistant", content: step.text });
      return;
    }
    messages.push({
      id: `${step.id}-message`,
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: step.id,
          type: "function",
          function: { name: step.name, arguments: JSON.stringify(step.args) },
        },
      ],
    });
    if (running && index === count - 1) return;
    messages.push({
      id: `${step.id}-result`,
      role: "tool",
      toolCallId: step.id,
      content: step.result,
      ...(step.error ? { error: step.error } : {}),
    });
  });
  return messages;
}

/**
 * `finished`: the whole run, as a restored thread shows it. `running`: stopped
 * in the middle of the second burst of calls. `live`: plays the run on a
 * clock, one call or result every 600ms.
 */
type Playback = "finished" | "running" | "live";

/** Registers the built-in tool card, which groups, and renders the view. */
const ToolCallDisplayView = defineComponent({
  name: "ToolCallDisplayView",
  props: {
    toolCallDisplay: {
      type: String as PropType<CopilotChatToolCallDisplay>,
      required: true,
    },
    playback: { type: String as PropType<Playback>, required: true },
  },
  setup(props) {
    useDefaultRenderTool();
    // Live: the question alone first, so the view sees the reply start (and
    // can time it). Then each step shows, and a call's result arrives.
    const ticks = steps.length * 2 + 1;
    const tick = ref(0);
    watch(
      () => props.playback,
      (playback, _previous, onCleanup) => {
        tick.value = 0;
        if (playback !== "live") return;
        const timer = setInterval(() => {
          tick.value++;
          if (tick.value >= ticks) clearInterval(timer);
        }, 600);
        onCleanup(() => clearInterval(timer));
      },
      { immediate: true },
    );
    const playing = () =>
      props.playback === "running" ||
      (props.playback === "live" && tick.value < ticks);
    const messages = () => {
      if (props.playback === "running") return messagesAfter(7, true);
      if (!playing()) return messagesAfter(steps.length, false);
      if (tick.value === 0) return messagesAfter(0, false);
      const step = tick.value - 1;
      return messagesAfter(Math.floor(step / 2) + 1, step % 2 === 0);
    };
    return () =>
      h(CopilotChatMessageView, {
        messages: messages(),
        isRunning: playing(),
        toolCallDisplay: props.toolCallDisplay,
      });
  },
});

const ToolCallDisplayDemo = defineComponent({
  name: "ToolCallDisplayDemo",
  props: {
    toolCallDisplay: {
      type: String as PropType<CopilotChatToolCallDisplay>,
      default: "grouped",
    },
    playback: { type: String as PropType<Playback>, default: "finished" },
  },
  setup(props) {
    return () =>
      // No Inspector, as in React's storybook: its toolbar shortcut would add
      // a toolbar to every tool-call message.
      h(CopilotKitProvider, { enableInspector: false }, () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "tool-call-display" },
          () =>
            h(
              "div",
              {
                style: {
                  margin: "0 auto",
                  width: "100%",
                  maxWidth: "42rem",
                  padding: "2.5rem 1.5rem",
                },
              },
              [h(ToolCallDisplayView, { ...props })],
            ),
        ),
      );
  },
});

/**
 * `toolCallDisplay` on `CopilotChatMessageView` (and on `CopilotChat`,
 * `CopilotPopup` and `CopilotSidebar`) decides how tool calls show. Calls
 * drawn by the built-in card group up.
 */
const meta = {
  title: "UI/Tool call display",
  component: ToolCallDisplayDemo,
  parameters: { layout: "fullscreen" },
  args: { toolCallDisplay: "grouped", playback: "finished" },
  argTypes: {
    toolCallDisplay: {
      control: "inline-radio",
      options: ["grouped", "line", "stacked", "turn", "separate"],
    },
    playback: {
      control: "inline-radio",
      options: ["finished", "running", "live"],
    },
  },
} satisfies Meta<typeof ToolCallDisplayDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default: calls made in a row share one card that opens to a row per call. */
export const Grouped: Story = {};

/** A quiet line of text, the sibling of the reasoning message's "Thought for 4 seconds". */
export const Line: Story = { args: { toolCallDisplay: "line" } };

/** The latest call on top of a stack of the earlier ones; click to fan it out. */
export const Stacked: Story = { args: { toolCallDisplay: "stacked" } };

/**
 * The agent works in the open, then everything before the reply folds into
 * "Worked for 9s". A restored thread (`playback: finished`) shows the tool
 * count, since how long it took is only known to a client that watched.
 */
export const Turn: Story = { args: { toolCallDisplay: "turn" } };

/** The `"turn"` display while the agent works: "Working 4s" above the work. */
export const TurnWorking: Story = {
  args: { toolCallDisplay: "turn", playback: "running" },
};

/** The `"turn"` display played on a clock, ending in "Worked for 9s". */
export const TurnLive: Story = {
  args: { toolCallDisplay: "turn", playback: "live" },
};

/** Every call its own card, as before grouping. */
export const Separate: Story = { args: { toolCallDisplay: "separate" } };

/** A group whose latest call is still running. */
export const Running: Story = { args: { playback: "running" } };
