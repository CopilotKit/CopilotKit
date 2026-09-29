import { onUnmounted } from "vue";
import type { Decorator } from "@storybook/vue3-vite";

/**
 * Replaces the microphone for recording stories, so no permission prompt
 * appears and nothing fails in headless browsers:
 *
 * - `navigator.mediaDevices.getUserMedia` resolves to a synthetic tone stream.
 * - `AnalyserNode#getByteTimeDomainData` returns a speech-like waveform, since
 *   autoplay policy can keep the recorder's AudioContext suspended (silent)
 *   until a user gesture.
 *
 * Both are restored when the last story using it unmounts.
 */
let activeUsers = 0;
let restore: (() => void) | null = null;

function install(): () => void {
  const hadMediaDevices = "mediaDevices" in navigator;
  if (!hadMediaDevices) {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {},
    });
  }
  const mediaDevices = navigator.mediaDevices;
  const ownGetUserMedia = Object.getOwnPropertyDescriptor(
    mediaDevices,
    "getUserMedia",
  );
  const originalRead = AnalyserNode.prototype.getByteTimeDomainData;

  const context = new AudioContext();
  const tone = context.createOscillator();
  tone.frequency.value = 220;
  const destination = context.createMediaStreamDestination();
  tone.connect(destination);
  tone.start();

  mediaDevices.getUserMedia = async () => destination.stream;
  AnalyserNode.prototype.getByteTimeDomainData = function (array) {
    const t = performance.now() / 1000;
    const level = Math.max(
      0.02,
      0.16 + 0.12 * Math.sin(t * 2.1) + 0.07 * Math.sin(t * 6.7 + 1),
    );
    for (let i = 0; i < array.length; i++) {
      array[i] = 128 + Math.round(127 * level * Math.sin(i / 5));
    }
  };

  return () => {
    AnalyserNode.prototype.getByteTimeDomainData = originalRead;
    if (!hadMediaDevices) {
      Reflect.deleteProperty(navigator, "mediaDevices");
    } else if (ownGetUserMedia) {
      Object.defineProperty(mediaDevices, "getUserMedia", ownGetUserMedia);
    } else {
      Reflect.deleteProperty(mediaDevices, "getUserMedia");
    }
    tone.stop();
    void context.close();
  };
}

export const withFakeMicrophone: Decorator = (story) => ({
  components: { story },
  setup() {
    // Install during setup: the story's recorder starts from its own
    // mount hooks, which run before this decorator's.
    if (activeUsers++ === 0) restore = install();
    onUnmounted(() => {
      if (--activeUsers === 0) {
        restore?.();
        restore = null;
      }
    });
  },
  template: `<story />`,
});
