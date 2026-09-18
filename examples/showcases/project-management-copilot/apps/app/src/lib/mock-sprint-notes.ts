/**
 * Mock "Sprint 52 Planning Notes" attachment for the "Plan next sprint"
 * suggestion chip.
 *
 * When the chip is clicked we synthesize a multimodal user message: the text
 * the user "would have typed" plus an `image` content part whose source is the
 * static `/sprint-52.png` shipped from `apps/app/public/`. CopilotKit's
 * <AttachmentRenderer> picks up the image part and renders it as a real image
 * thumbnail above the user bubble — same affordance as if the user had dropped
 * a screenshot of their handwritten planning page into the input.
 *
 * The previous version of this file emitted a `document` part with a base64
 * text/plain blob, which CopilotKit's UI tried to render via the image
 * renderer and surfaced "Failed to load image" because the underlying data URL
 * wasn't an image. The image attachment removes that failure entirely.
 *
 * See: apps/agent/main.py — agent instructions; fixtures/sprint-planning.json
 * — the canned response chain under USE_MOCK=1.
 */

export const SPRINT_NOTES_FILENAME = "Sprint 52 Planning Notes.png";
export const SPRINT_NOTES_IMAGE_URL = "/sprint-52.png";

/**
 * Build the multimodal `content` array for a user message that includes the
 * mock sprint notes as an image attachment. Mirrors the shape
 * <CopilotChat>'s onSubmitInput produces when the user actually drops an image
 * into the input: a [text, image] array where the image carries a `url`-type
 * source pointing at a static asset under the app's public folder.
 */
export function buildSprintNotesMessageContent(text: string): Array<
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "url"; value: string; mimeType: string };
      metadata: { filename: string };
    }
> {
  return [
    { type: "text", text },
    {
      type: "image",
      source: {
        type: "url",
        value: SPRINT_NOTES_IMAGE_URL,
        mimeType: "image/png",
      },
      metadata: { filename: SPRINT_NOTES_FILENAME },
    },
  ];
}
