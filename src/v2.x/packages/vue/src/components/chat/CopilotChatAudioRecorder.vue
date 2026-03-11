<script setup lang="ts">
import { onBeforeUnmount, ref, useAttrs, watch } from "vue";
import { AudioRecorderError, type AudioRecorderState } from "./audioRecorder";

defineOptions({ inheritAttrs: false });

const attrs = useAttrs();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const recorderState = ref<AudioRecorderState>("idle");
const mediaRecorderRef = ref<MediaRecorder | null>(null);
const streamRef = ref<MediaStream | null>(null);
const analyserRef = ref<AnalyserNode | null>(null);
const audioContextRef = ref<AudioContext | null>(null);
const animationIdRef = ref<number | null>(null);
const audioChunksRef = ref<Blob[]>([]);
const amplitudeHistoryRef = ref<number[]>([]);
const scrollOffsetRef = ref(0);
const smoothedAmplitudeRef = ref(0);
const fadeOpacityRef = ref(0);

function cleanup() {
  if (animationIdRef.value !== null) {
    cancelAnimationFrame(animationIdRef.value);
    animationIdRef.value = null;
  }

  const recorder = mediaRecorderRef.value;
  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      // ignore cleanup stop failures
    }
  }

  if (streamRef.value) {
    streamRef.value.getTracks().forEach((track) => track.stop());
    streamRef.value = null;
  }

  const audioContext = audioContextRef.value;
  if (audioContext && audioContext.state !== "closed") {
    audioContext.close().catch(() => {
      // ignore close errors
    });
  }

  mediaRecorderRef.value = null;
  analyserRef.value = null;
  audioContextRef.value = null;
  audioChunksRef.value = [];
  amplitudeHistoryRef.value = [];
  scrollOffsetRef.value = 0;
  smoothedAmplitudeRef.value = 0;
  fadeOpacityRef.value = 0;
}

async function start() {
  if (recorderState.value !== "idle") {
    throw new AudioRecorderError("Recorder is already active");
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.value = stream;

    const audioContext = new AudioContext();
    audioContextRef.value = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.value = analyser;

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

    const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
    const recorder = new MediaRecorder(stream, options);
    mediaRecorderRef.value = recorder;
    audioChunksRef.value = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.value.push(event.data);
      }
    };

    recorder.start(100);
    recorderState.value = "recording";
  } catch (error) {
    cleanup();
    if (error instanceof Error && error.name === "NotAllowedError") {
      throw new AudioRecorderError("Microphone permission denied");
    }
    if (error instanceof Error && error.name === "NotFoundError") {
      throw new AudioRecorderError("No microphone found");
    }
    throw new AudioRecorderError(error instanceof Error ? error.message : "Failed to start recording");
  }
}

function stop() {
  return new Promise<Blob>((resolve, reject) => {
    const recorder = mediaRecorderRef.value;
    if (!recorder || recorderState.value !== "recording") {
      reject(new AudioRecorderError("No active recording"));
      return;
    }

    recorderState.value = "processing";
    recorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.value, { type: recorder.mimeType || "audio/webm" });
      cleanup();
      recorderState.value = "idle";
      resolve(audioBlob);
    };
    recorder.onerror = () => {
      cleanup();
      recorderState.value = "idle";
      reject(new AudioRecorderError("Recording failed"));
    };
    recorder.stop();
  });
}

function calculateAmplitude(dataArray: Uint8Array) {
  let sum = 0;
  for (let index = 0; index < dataArray.length; index += 1) {
    const sample = (dataArray[index] ?? 128) / 128 - 1;
    sum += sample * sample;
  }
  return Math.sqrt(sum / dataArray.length);
}

function drawFrame() {
  const canvas = canvasRef.value;
  if (!canvas) {
    return;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    context.scale(dpr, dpr);
  }

  const barWidth = 2;
  const barGap = 1;
  const barSpacing = barWidth + barGap;
  const maxBars = Math.floor(rect.width / barSpacing) + 2;

  if (analyserRef.value && recorderState.value === "recording") {
    if (amplitudeHistoryRef.value.length === 0) {
      amplitudeHistoryRef.value = new Array(maxBars).fill(0);
    }

    if (fadeOpacityRef.value < 1) {
      fadeOpacityRef.value = Math.min(1, fadeOpacityRef.value + 0.03);
    }

    scrollOffsetRef.value += 1 / 3;
    const bufferLength = analyserRef.value.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.value.getByteTimeDomainData(dataArray);
    const rawAmplitude = calculateAmplitude(dataArray);
    const attackSpeed = 0.12;
    const decaySpeed = 0.08;
    const speed = rawAmplitude > smoothedAmplitudeRef.value ? attackSpeed : decaySpeed;
    smoothedAmplitudeRef.value += (rawAmplitude - smoothedAmplitudeRef.value) * speed;

    if (scrollOffsetRef.value >= barSpacing) {
      scrollOffsetRef.value -= barSpacing;
      amplitudeHistoryRef.value.push(smoothedAmplitudeRef.value);
      if (amplitudeHistoryRef.value.length > maxBars) {
        amplitudeHistoryRef.value = amplitudeHistoryRef.value.slice(-maxBars);
      }
    }
  }

  context.clearRect(0, 0, rect.width, rect.height);
  const computedStyle = window.getComputedStyle(canvas);
  context.fillStyle = computedStyle.color;
  context.globalAlpha = fadeOpacityRef.value;

  const centerY = rect.height / 2;
  const maxAmplitude = rect.height / 2 - 2;
  const edgeFadeWidth = 12;

  for (let index = 0; index < amplitudeHistoryRef.value.length; index += 1) {
    const amplitude = amplitudeHistoryRef.value[index] ?? 0;
    const scaledAmplitude = Math.min(amplitude * 4, 1);
    const barHeight = Math.max(2, scaledAmplitude * maxAmplitude * 2);
    const x = rect.width - (amplitudeHistoryRef.value.length - index) * barSpacing - scrollOffsetRef.value;
    const y = centerY - barHeight / 2;
    if (x + barWidth <= 0 || x >= rect.width) {
      continue;
    }

    let edgeOpacity = 1;
    if (x < edgeFadeWidth) {
      edgeOpacity = Math.max(0, x / edgeFadeWidth);
    } else if (x > rect.width - edgeFadeWidth) {
      edgeOpacity = Math.max(0, (rect.width - x) / edgeFadeWidth);
    }

    context.globalAlpha = fadeOpacityRef.value * edgeOpacity;
    context.fillRect(x, y, barWidth, barHeight);
  }

  animationIdRef.value = requestAnimationFrame(drawFrame);
}

watch(
  recorderState,
  () => {
    if (animationIdRef.value !== null) {
      cancelAnimationFrame(animationIdRef.value);
      animationIdRef.value = null;
    }
    animationIdRef.value = requestAnimationFrame(drawFrame);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  cleanup();
});

defineExpose({
  get state() {
    return recorderState.value;
  },
  start,
  stop,
  dispose: cleanup,
});
</script>

<template>
  <div
    class="w-full px-5 py-3"
    v-bind="attrs"
  >
    <canvas ref="canvasRef" class="block h-[26px] w-full" />
  </div>
</template>
