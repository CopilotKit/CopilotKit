import { defineComponent, onBeforeUnmount, onMounted, ref } from "vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotChatAudioRecorder } from "@copilotkit/vue";
import { withFakeMicrophone } from "./support/fake-microphone";
import { withCenteredStage } from "./support/layouts";

type RecorderHandle = {
  state: string;
  start: () => Promise<void>;
  stop: () => Promise<Blob>;
  dispose: () => void;
};

/**
 * The live waveform shown in the chat input while dictating. It is driven
 * imperatively through its template ref (`start()` / `stop()`); these stories
 * use a synthetic microphone, so nothing asks for mic access.
 */
const Frame = defineComponent({
  name: "RecorderFrame",
  props: { caption: { type: String, required: true } },
  template: `
    <figure style="margin: 0" class="story-stack">
      <div class="story-panel" style="padding: 0; border-radius: 16px">
        <slot />
      </div>
      <figcaption class="story-caption" style="text-align: center">{{ caption }}</figcaption>
    </figure>
  `,
});

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
  render: () => ({
    components: { Frame, CopilotChatAudioRecorder },
    template: `
      <Frame caption="Idle: the waveform area stays blank until recording starts">
        <CopilotChatAudioRecorder />
      </Frame>
    `,
  }),
};

const RecorderDemo = defineComponent({
  name: "RecorderDemo",
  components: { Frame, CopilotChatAudioRecorder },
  setup() {
    const recorder = ref<RecorderHandle | null>(null);
    const state = ref("idle");

    const start = () => {
      recorder.value
        ?.start()
        .then(() => {
          state.value = "recording";
        })
        .catch((error: unknown) =>
          console.warn("Recorder failed to start", error),
        );
    };
    const stop = () => {
      state.value = "processing";
      recorder.value
        ?.stop()
        .then(() => {
          state.value = "idle";
        })
        .catch(() => {
          state.value = "idle";
        });
    };

    onMounted(start);
    onBeforeUnmount(() => recorder.value?.dispose());

    return { recorder, state, start, stop };
  },
  template: `
    <Frame :caption="'State: ' + state">
      <CopilotChatAudioRecorder ref="recorder" />
      <div style="display: flex; justify-content: flex-end; border-top: 1px solid var(--border); padding: 8px 12px">
        <button
          type="button"
          class="story-button"
          :disabled="state === 'processing'"
          @click="state === 'recording' ? stop() : start()"
        >
          {{ state === "recording" ? "Stop" : "Record" }}
        </button>
      </div>
    </Frame>
  `,
});

/** Recording from a synthetic microphone: the waveform scrolls in from the right. */
export const Recording: Story = {
  decorators: [withFakeMicrophone],
  render: () => ({
    components: { RecorderDemo },
    template: `<RecorderDemo />`,
  }),
};
