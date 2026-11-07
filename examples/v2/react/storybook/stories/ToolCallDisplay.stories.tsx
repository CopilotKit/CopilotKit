import React, { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { RotateCcw } from "lucide-react";
import {
  CopilotChatMessageView,
  WildcardToolCallRender,
} from "@copilotkit/react-core/v2";
import type { CopilotChatToolCallDisplay } from "@copilotkit/react-core/v2";
import { withMessageColumn } from "./support/layouts";
import { demoToolRenderers } from "./support/ToolCards";
import {
  debugBuildRun,
  pricingExperimentRun,
  useScriptedRun,
} from "./support/scripted-run";

const runs = { debug: debugBuildRun, pricing: pricingExperimentRun };

interface ToolCallDisplayDemoProps {
  /** `CopilotChatMessageView`'s `toolCallDisplay`. */
  toolCallDisplay: CopilotChatToolCallDisplay;
  run: keyof typeof runs;
  /** Play the run on a clock, or show it finished (as a restored thread would). */
  playback: "live" | "finished";
}

/**
 * The real `CopilotChatMessageView`, fed the messages of a scripted run as it
 * plays. Replay restarts it.
 */
const ToolCallDisplayDemo: React.FC<ToolCallDisplayDemoProps> = ({
  toolCallDisplay,
  run,
  playback,
}) => {
  const [runKey, setRunKey] = useState(0);
  const [live, setLive] = useState(playback === "live");
  useEffect(() => setLive(playback === "live"), [playback]);
  const { messages, isRunning } = useScriptedRun(runs[run], live, runKey);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setLive(true);
          setRunKey((key) => key + 1);
        }}
        className="absolute -top-8 right-0 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <RotateCcw className="size-3" aria-hidden="true" />
        {isRunning ? "Restart" : "Replay"}
      </button>
      <CopilotChatMessageView
        key={runKey}
        messages={messages}
        isRunning={isRunning}
        toolCallDisplay={toolCallDisplay}
      />
    </div>
  );
};

/**
 * `toolCallDisplay` on `CopilotChatMessageView` (reach it from `CopilotChat`
 * as `messageView={{ toolCallDisplay: "line" }}`) decides how tool calls show.
 * Calls drawn by the wildcard renderer group up; `search` and `calculator`
 * have renderers of their own here, so they always show.
 */
const meta = {
  title: "UI/Tool call display",
  component: ToolCallDisplayDemo,
  parameters: {
    layout: "fullscreen",
    copilotkit: {
      provider: {
        renderToolCalls: [...demoToolRenderers, WildcardToolCallRender],
      },
    },
  },
  args: {
    toolCallDisplay: "grouped",
    run: "debug",
    playback: "live",
  },
  argTypes: {
    toolCallDisplay: {
      control: "inline-radio",
      options: ["grouped", "line", "stacked", "turn", "separate"],
    },
    run: { control: "inline-radio", options: Object.keys(runs) },
    playback: { control: "inline-radio", options: ["live", "finished"] },
  },
} satisfies Meta<typeof ToolCallDisplayDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default: calls made in a row share one card that opens to a row per call. */
export const Grouped: Story = {
  decorators: [withMessageColumn],
};

/** A quiet line of text, the sibling of the reasoning message's "Thought for 4 seconds". */
export const Line: Story = {
  args: { toolCallDisplay: "line" },
  decorators: [withMessageColumn],
};

/** The latest call on top of a stack of the earlier ones; click to fan it out. */
export const Stacked: Story = {
  args: { toolCallDisplay: "stacked" },
  decorators: [withMessageColumn],
};

/**
 * The agent works in the open, then everything before the reply folds into
 * "Worked for 9s". A restored thread (`playback: finished`) shows the tool
 * count, since how long it took is only known to a client that watched.
 */
export const Turn: Story = {
  args: { toolCallDisplay: "turn" },
  decorators: [withMessageColumn],
};

/** Every call its own card, as before grouping. */
export const Separate: Story = {
  args: { toolCallDisplay: "separate" },
  decorators: [withMessageColumn],
};

/** Calls with renderers of their own stay visible and split the group around them. */
export const CustomRenderersStayVisible: Story = {
  args: { run: "pricing" },
  decorators: [withMessageColumn],
};

const displays: CopilotChatToolCallDisplay[] = [
  "grouped",
  "line",
  "stacked",
  "turn",
  "separate",
];

/** Every display side by side, finished. */
export const Compare: Story = {
  args: { playback: "finished" },
  decorators: [
    (Story) => (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] gap-x-8 gap-y-12 p-8">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <>
      {displays.map((display) => (
        <section key={display} className="min-w-0">
          <h2 className="mb-10 font-mono text-sm text-muted-foreground">
            {display}
          </h2>
          <ToolCallDisplayDemo {...args} toolCallDisplay={display} />
        </section>
      ))}
    </>
  ),
};
