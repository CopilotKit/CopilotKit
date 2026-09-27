import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  input,
  signal,
  viewChild,
} from "@angular/core";
import type { Meta, StoryObj } from "@storybook/angular";
import { moduleMetadata } from "@storybook/angular";
import { CopilotChatAudioRecorder } from "@copilotkit/angular";
import type { AudioRecorderState } from "@copilotkit/angular";
import { withFakeMicrophone } from "./support/fake-microphone";
import { withCenteredStage } from "./support/layouts";

/**
 * Drives the real recorder so each story can show a state. Stories use a
 * synthetic microphone (see support/fake-microphone.ts): no permission prompt,
 * and the waveform draws a steady tone.
 */
@Component({
  selector: "story-audio-recorder",
  imports: [CopilotChatAudioRecorder],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-copilotkit class="frame">
      <copilot-chat-audio-recorder (stateChange)="state.set($event)" />
    </div>
    <p class="story-note">
      State: <code>{{ state() }}</code>
      <button type="button" class="story-icon-button" (click)="toggle()">
        {{ state() === "recording" ? "■" : "●" }}
      </button>
    </p>
  `,
  styles: `
    .frame {
      border: 1px solid var(--border);
      border-radius: 1.5rem;
      background: transparent;
      color: var(--foreground);
    }
    .story-note {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
  `,
})
class StoryAudioRecorder {
  readonly autoStart = input(false);
  protected readonly state = signal<AudioRecorderState>("idle");
  private readonly recorder = viewChild.required(CopilotChatAudioRecorder);

  constructor() {
    afterNextRender(() => {
      if (this.autoStart()) void this.recorder().start();
    });
  }

  protected toggle(): void {
    const recorder = this.recorder();
    if (this.state() === "recording") void recorder.stop();
    else void recorder.start();
  }
}

const meta: Meta<StoryAudioRecorder> = {
  title: "UI/CopilotChatAudioRecorder",
  component: StoryAudioRecorder,
  decorators: [
    moduleMetadata({ imports: [StoryAudioRecorder] }),
    withFakeMicrophone,
    withCenteredStage,
  ],
  render: (args) => ({
    props: args,
    template: `<story-audio-recorder [autoStart]="autoStart" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryAudioRecorder>;

/** Not recording yet: an empty canvas. Use the button to start. */
export const Idle: Story = {
  args: { autoStart: false },
};

/** Recording from the (synthetic) microphone with a live waveform. */
export const Recording: Story = {
  args: { autoStart: true },
};
