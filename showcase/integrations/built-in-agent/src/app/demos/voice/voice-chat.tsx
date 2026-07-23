"use client";

import { useCallback } from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { SampleAudioButton } from "./sample-audio-button";

const AGENT_ID = "voice-demo";
const SAMPLE_TEXT = "What is the weather in Tokyo?";

// Voice demo.
//
// Two affordances live on this page:
//
// 1. The default mic button rendered by <CopilotChat /> when the runtime at
//    RUNTIME_URL advertises `audioFileTranscriptionEnabled: true`. Click it,
//    speak, click again — text is transcribed into the composer.
//
// 2. The <SampleAudioButton /> below the chat, which synchronously injects a
//    canned phrase into the chat's textarea (bypassing mic permissions and
//    the runtime's transcription endpoint so Playwright and screenshot flows
//    work too). The mic path is the only affordance that exercises real
//    transcription; the sample button is a deterministic test/demo
//    affordance.
//
// Injecting text into the composer goes through the DOM: CopilotChat owns its
// input state internally (no external controlled-input API on v2 today), but
// the textarea is tagged `data-testid="copilot-chat-textarea"`. Setting its
// value via the native HTMLTextareaElement value setter and dispatching a
// synthetic `input` event is the React-compatible way to flip the managed
// state without reaching into CopilotChat's internals.
export function VoiceChat() {
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
    // React tracks its own "last known value" on controlled inputs. Calling
    // the native setter is what makes React observe the change on the next
    // input event.
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
