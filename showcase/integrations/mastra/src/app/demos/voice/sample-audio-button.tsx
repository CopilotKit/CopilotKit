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
   * Phrase that doubles as the visible caption AND the text injected
   * into the composer when the button is clicked.
   */
  sampleText: string;
}

// @region[sample-audio-button]
export function SampleAudioButton({
  onTranscribed,
  sampleText,
}: SampleAudioButtonProps) {
  return (
    <div
      data-testid="voice-sample-audio"
      className="flex items-center gap-3 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.02]"
    >
      <button
        type="button"
        data-testid="voice-sample-audio-button"
        onClick={() => onTranscribed(sampleText)}
        className="rounded border border-black/10 bg-white px-3 py-1 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:bg-black/30 dark:hover:bg-white/10"
      >
        Play sample
      </button>
      <span className="text-black/60 dark:text-white/60">
        Sample: &ldquo;{sampleText}&rdquo;
      </span>
    </div>
  );
}
// @endregion[sample-audio-button]
