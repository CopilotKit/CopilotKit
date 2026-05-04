"use client";

import { use, useCallback } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import { SampleAudioButton } from "./sample-audio-button";

const DEMO_ID = "voice";
const SAMPLE_AUDIO_PATH = "/demo-audio/sample.wav";
const SAMPLE_LABEL = "What is the weather in Tokyo?";

// Voice demo.
//
// Two affordances live on this page:
//
// 1. The default mic button rendered by <CopilotChat /> when the runtime
//    advertises `audioFileTranscriptionEnabled: true`. Click it,
//    speak, click again — text is transcribed into the composer.
//
// 2. The <SampleAudioButton /> below the chat, which fetches a bundled
//    sample.wav, POSTs it to the same transcription endpoint, and writes the
//    result into the chat's textarea (bypassing mic permissions so Playwright
//    and screenshot flows work too).
// @region[voice-page]
export default function VoiceDemoPage({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  const runtimeUrl = `/api/${framework}/${DEMO_ID}`;

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
      runtimeUrl={runtimeUrl}
      agent={DEMO_ID}
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
          runtimeUrl={runtimeUrl}
          audioSrc={SAMPLE_AUDIO_PATH}
          sampleLabel={SAMPLE_LABEL}
        />
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-black/10 dark:border-white/10">
          <CopilotChat agentId={DEMO_ID} className="h-full" />
        </div>
      </div>
    </CopilotKit>
  );
}
// @endregion[voice-page]
