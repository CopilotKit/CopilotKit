"use client";

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
  onTranscribed,
  sampleText,
}: SampleAudioButtonProps) {
  return (
    <button
      type="button"
      data-testid="voice-sample-audio-button"
      onClick={() => onTranscribed(sampleText)}
      title={`Inserts: "${sampleText}"`}
      className="inline-flex w-fit items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:bg-black/30 dark:hover:bg-white/10"
    >
      <span aria-hidden>🎙</span>
      <span>Try a sample question</span>
    </button>
  );
}
// @endregion[sample-audio-button]
