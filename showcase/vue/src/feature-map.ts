import AgenticChatFeature from "./features/AgenticChatFeature.vue";

export type FeatureComponentKey = "agentic-chat";

/** Select an explicitly implemented Vue feature; there is no generic fallback. */
export function resolveFeatureComponentKey(
  feature: string,
): FeatureComponentKey {
  if (feature === "agentic-chat") return "agentic-chat";
  throw new Error(`Feature "${feature}" does not have a Vue implementation.`);
}

/** Resolve the canonical Vue component for one implemented feature. */
export function componentForFeature(feature: string) {
  switch (resolveFeatureComponentKey(feature)) {
    case "agentic-chat":
      return AgenticChatFeature;
  }
}
