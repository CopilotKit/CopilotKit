import React, { useEffect, useState } from "react";
import type { Decorator } from "@storybook/react-vite";

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
    if (ownGetUserMedia) {
      Object.defineProperty(mediaDevices, "getUserMedia", ownGetUserMedia);
    } else {
      delete (mediaDevices as { getUserMedia?: unknown }).getUserMedia;
    }
    tone.stop();
    void context.close();
  };
}

function useFakeMicrophone() {
  // Install during render: children start recording from their own effects,
  // which run before this component's effects.
  useState(() => {
    if (activeUsers++ === 0) restore = install();
    return null;
  });
  useEffect(
    () => () => {
      if (--activeUsers === 0) {
        restore?.();
        restore = null;
      }
    },
    [],
  );
}

const FakeMicrophone: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  useFakeMicrophone();
  return <>{children}</>;
};

export const withFakeMicrophone: Decorator = (Story) => (
  <FakeMicrophone>
    <Story />
  </FakeMicrophone>
);
