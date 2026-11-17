"use client";

/**
 * The sample-audio button of the voice demo.
 *
 * Clicking it puts a fixed phrase into the chat composer at once, through
 * `onTranscribed(sampleText)`. It records no audio and calls no
 * `/transcribe` endpoint: the mic button that `<CopilotChat />` renders does
 * that. Because the button does not depend on the transcription service or
 * on an aimock fixture, the voice probe and the e2e spec stay deterministic.
 */
export interface SampleAudioButtonProps {
  /** Called with the sample phrase when the button is clicked. */
  onTranscribed: (text: string) => void;
  /**
   * The phrase that the button puts into the composer. The button's tooltip
   * shows it, so users can see what the sample says.
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
      <span>Try a sample audio</span>
    </button>
  );
}
// @endregion[sample-audio-button]
