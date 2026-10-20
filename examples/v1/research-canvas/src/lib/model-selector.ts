const supportedModels = ["openai", "anthropic", "google_genai"] as const;

export type SupportedModel = (typeof supportedModels)[number];

/** Returns a supported model name for the model selector query parameter. */
export function normalizeModel(
  model: string | null | undefined,
): SupportedModel {
  return (
    supportedModels.find((supportedModel) => supportedModel === model) ??
    "openai"
  );
}
