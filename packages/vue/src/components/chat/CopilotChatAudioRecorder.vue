<script setup lang="ts">
/**
 * Records from the microphone and draws the live level as a scrolling
 * waveform. The recording itself is `ɵAudioRecorder` from
 * `@copilotkit/core`; control it through the exposed ref.
 */
import { onBeforeUnmount, onMounted, ref, useAttrs } from "vue";
import { ɵAudioRecorder, ɵcreateWaveformRenderer } from "@copilotkit/core";

defineOptions({ inheritAttrs: false });

const attrs = useAttrs();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const recorder = new ɵAudioRecorder();
let waveform: { dispose: () => void } | undefined;

onMounted(() => {
  if (canvasRef.value) {
    waveform = ɵcreateWaveformRenderer(canvasRef.value, recorder);
  }
});

onBeforeUnmount(() => {
  waveform?.dispose();
  recorder.dispose();
});

defineExpose({
  get state() {
    return recorder.getSnapshot();
  },
  start: () => recorder.start(),
  stop: () => recorder.stop(),
  dispose: () => recorder.dispose(),
});
</script>

<template>
  <div data-copilotkit class="cpk-audio-recorder" v-bind="attrs">
    <canvas ref="canvasRef" class="cpk-audio-recorder-canvas" />
  </div>
</template>
