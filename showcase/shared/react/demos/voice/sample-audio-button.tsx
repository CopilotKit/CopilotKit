"use client";

import { useCallback } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

/**
 * Sample-audio button for the voice demo.
 *
 * Pure test/demo affordance: clicking the button synchronously injects a
 * canned phrase into the chat composer via `onTranscribed(sampleText)`.
 * No microphone permission, no audio fetch, no `/transcribe` round trip
 * — those concerns belong to the mic button rendered by `<CopilotChat />`.
 * Keeping this affordance deterministic means the d5-voice probe and the
 * Playwright e2e never depend on the runtime's transcription endpoint
 * being healthy or on any specific aimock fixture surviving across
 * environments.
 */
export interface SampleAudioButtonProps {
  /** Agent bound by the sibling CopilotChat and parent CopilotKit provider. */
  agentId: string;
  /** Called with the canned sample text when the button is clicked. */
  onTranscribed: (text: string) => void;
  /**
   * Phrase injected into the composer when the button is clicked. Used as
   * the tooltip so users can preview what the sample says without taking
   * up visual space on the page.
   */
  sampleText: string;
}

// @region[sample-audio-button]
export function SampleAudioButton({
  agentId,
  onTranscribed,
  sampleText,
}: SampleAudioButtonProps) {
  const { isReady } = useAgent({ agentId });
  const insertSample = useCallback(() => {
    // useAgent exposes a provisional instance before the runtime info request
    // completes. Do not mutate CopilotChat's composer until its real agent is
    // ready: its own readiness guard will otherwise drop the subsequent Enter.
    if (!isReady) return;
    onTranscribed(sampleText);
  }, [isReady, onTranscribed, sampleText]);

  return (
    <button
      type="button"
      data-testid="voice-sample-audio-button"
      disabled={!isReady}
      onClick={insertSample}
      title={isReady ? `Inserts: "${sampleText}"` : "Connecting to the agent…"}
      className="inline-flex w-fit items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-black/30 dark:hover:bg-white/10"
    >
      <span aria-hidden>🎙</span>
      <span>{isReady ? "Try a sample audio" : "Connecting…"}</span>
    </button>
  );
}
// @endregion[sample-audio-button]
