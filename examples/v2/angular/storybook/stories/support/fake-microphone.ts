import { componentWrapperDecorator } from "@storybook/angular";

let installed = false;

/**
 * Replaces `navigator.mediaDevices.getUserMedia` with a synthetic audio stream
 * (a quiet oscillator), so recorder and transcribe-mode stories run the real
 * recording code without a microphone prompt, hardware, or console errors.
 * Storybook-only; installed once per preview iframe.
 */
export function installFakeMicrophone(): void {
  if (installed || typeof navigator === "undefined") return;
  installed = true;

  const getUserMedia = async (): Promise<MediaStream> => {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = 220;
    gain.gain.value = 0.2;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    return destination.stream;
  };

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { ...navigator.mediaDevices, getUserMedia },
  });
}

/** Story decorator form of {@link installFakeMicrophone}. */
export const withFakeMicrophone = componentWrapperDecorator((story) => {
  installFakeMicrophone();
  return story;
});
