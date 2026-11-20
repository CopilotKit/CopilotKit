import React, { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopilotChatAudioRecorder } from "@copilotkit/react-core/v2";
import type { AudioRecorderState } from "@copilotkit/react-core/v2";
import { withFakeMicrophone } from "./support/fake-microphone";
import { withCenteredStage } from "./support/layouts";

type RecorderHandle = React.ElementRef<typeof CopilotChatAudioRecorder>;

/**
 * The live waveform shown in the chat input while dictating. It is driven
 * imperatively through its ref (`start()` / `stop()`); these stories use a
 * synthetic microphone, so nothing asks for mic access.
 */
const Frame: React.FC<{ caption: string; children: React.ReactNode }> = ({
  caption,
  children,
}) => (
  <figure className="space-y-3">
    <div className="rounded-2xl border border-border bg-card text-foreground">
      {children}
    </div>
    <figcaption className="text-center text-xs text-muted-foreground">
      {caption}
    </figcaption>
  </figure>
);

const meta = {
  title: "UI/CopilotChatAudioRecorder",
  component: CopilotChatAudioRecorder,
  decorators: [withCenteredStage],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CopilotChatAudioRecorder>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before `start()`: the canvas is reserved but empty. */
export const Idle: Story = {
  render: (args) => (
    <Frame caption="Idle: the waveform area stays blank until recording starts">
      <CopilotChatAudioRecorder {...args} />
    </Frame>
  ),
};

const RecorderDemo: React.FC<
  React.ComponentProps<typeof CopilotChatAudioRecorder>
> = (props) => {
  const ref = useRef<RecorderHandle>(null);
  const [state, setState] = useState<AudioRecorderState>("idle");

  const start = () => {
    ref.current
      ?.start()
      .then(() => setState("recording"))
      .catch((error: unknown) =>
        console.warn("Recorder failed to start", error),
      );
  };
  const stop = () => {
    setState("processing");
    ref.current
      ?.stop()
      .then(() => setState("idle"))
      .catch(() => setState("idle"));
  };

  useEffect(() => {
    start();
    return () => ref.current?.dispose();
  }, []);

  return (
    <Frame caption={`State: ${state}`}>
      <CopilotChatAudioRecorder ref={ref} {...props} />
      <div className="flex justify-end border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={state === "recording" ? stop : start}
          disabled={state === "processing"}
          className="rounded-md px-3 py-1 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {state === "recording" ? "Stop" : "Record"}
        </button>
      </div>
    </Frame>
  );
};

/** Recording from a synthetic microphone: the waveform scrolls in from the right. */
export const Recording: Story = {
  decorators: [withFakeMicrophone],
  render: (args) => <RecorderDemo {...args} />,
};
