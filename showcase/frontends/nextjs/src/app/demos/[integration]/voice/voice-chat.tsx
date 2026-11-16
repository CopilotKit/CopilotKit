"use client";

import { useCallback } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { SampleAudioButton } from "./sample-audio-button";

const AGENT_ID = "voice-demo";
const SAMPLE_TEXT = "What is the weather in Tokyo?";

// The voice demo has two ways to fill the composer:
//
// 1. The mic button that <CopilotChat /> renders when the runtime reports
//    `audioFileTranscriptionEnabled: true`. Click it, speak, and click it
//    again: the runtime transcribes the audio into the composer. This is the
//    only path that runs real transcription.
// 2. <SampleAudioButton />, which puts a fixed phrase into the composer at
//    once. It needs no microphone and no transcription, so Playwright and
//    screenshot runs can use it.
//
// CopilotChat keeps its input state to itself, but its textarea has
// `data-testid="copilot-chat-textarea"`. Setting the value with the native
// HTMLTextAreaElement setter and then sending an `input` event is how React
// sees the change without reaching into CopilotChat.
export function VoiceChat() {
  const handleTranscribed = useCallback((text: string) => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="copilot-chat-textarea"]',
    );
    if (!textarea) {
      console.warn(
        "[voice-demo] could not find copilot-chat-textarea to populate",
      );
      return;
    }
    // React tracks the last value it saw on a controlled input. Calling the
    // native setter makes React notice the change on the next input event.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(textarea, text);
    } else {
      textarea.value = text;
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  }, []);

  return (
    <div className="flex h-screen flex-col gap-3 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Voice input</h1>
        <SampleAudioButton
          onTranscribed={handleTranscribed}
          sampleText={SAMPLE_TEXT}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-black/10 dark:border-white/10">
        <CopilotChat agentId={AGENT_ID} className="h-full" />
      </div>
    </div>
  );
}
