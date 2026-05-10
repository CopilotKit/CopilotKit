"use client";

import { useCallback } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { SampleAudioButton } from "./sample-audio-button";

const RUNTIME_URL = "/api/copilotkit-voice";
const AGENT_ID = "voice-demo";
const SAMPLE_TEXT = "What is the weather in Tokyo?";

/**
 * Voice demo (Spring AI port).
 *
 * Voice input is a FRONTEND/RUNTIME concern. The transcription service is
 * mounted on the NextJS runtime route (`/api/copilotkit-voice`), so when
 * CopilotChat probes the runtime, `audioFileTranscriptionEnabled: true`
 * causes the microphone button to render. The transcribed text is sent
 * as a plain message to the same Spring-AI ChatClient used by the other
 * demos — the Java backend is unchanged.
 */
// @region[voice-page]
export default function VoiceDemoPage() {
  const handleTranscribed = useCallback((text: string) => {
    if (typeof document === "undefined") return;
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="copilot-chat-textarea"]',
    );
    if (!textarea) {
      console.warn(
        "[voice-demo] could not find copilot-chat-textarea to populate",
      );
      return;
    }
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
    <CopilotKit
      runtimeUrl={RUNTIME_URL}
      agent={AGENT_ID}
      useSingleEndpoint={false}
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <header>
          <h1 className="text-lg font-semibold">Voice input</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Click the microphone to record, or play the bundled sample audio.
            Speech is transcribed into the input field — you click send.
          </p>
        </header>
        <SampleAudioButton
          onTranscribed={handleTranscribed}
          sampleText={SAMPLE_TEXT}
        />
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-black/10 dark:border-white/10">
          <CopilotChat agentId={AGENT_ID} className="h-full" />
        </div>
      </div>
    </CopilotKit>
  );
}
// @endregion[voice-page]
