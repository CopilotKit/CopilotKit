import type { AgentCapabilities } from "@ag-ui/client";

/** Only a complete, explicit input profile supplies a default upload policy. */
export function attachmentAcceptFromCapabilities(
  capabilities: AgentCapabilities | undefined,
): string | undefined {
  const input = capabilities?.multimodal?.input;
  if (
    !input ||
    [input.image, input.pdf, input.audio, input.video, input.file].some(
      (supported) => typeof supported !== "boolean",
    )
  ) {
    return undefined;
  }
  if (input.file) return "*/*";
  return [
    input.image && "image/*",
    input.pdf && "application/pdf",
    input.audio && "audio/*",
    input.video && "video/*",
  ]
    .filter(Boolean)
    .join(",");
}
