import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface VueSourceContent {
  files: Record<string, { language: "vue"; content: string }>;
  defaultFileByFeature: Record<string, string>;
}

const DEFAULT_FILE_BY_FEATURE: Readonly<Record<string, string>> = {
  "agentic-chat": "features/AgenticChatFeature.vue",
};

/** Build the bounded source bundle used by runnable Vue Showcase code routes. */
export function buildVueSourceContent(showcaseRoot: string): VueSourceContent {
  const registry = JSON.parse(
    readFileSync(join(showcaseRoot, "shared/frontend-registry.json"), "utf8"),
  ) as {
    feature_support: Record<string, { vue?: { state: string } }>;
  };
  const supported = Object.entries(registry.feature_support)
    .filter(([, support]) => support.vue?.state === "supported")
    .map(([feature]) => feature)
    .sort();
  const defaults = Object.keys(DEFAULT_FILE_BY_FEATURE).sort();
  if (JSON.stringify(defaults) !== JSON.stringify(supported)) {
    throw new Error(
      "Vue source defaults must match the supported feature registry.",
    );
  }

  const files = Object.fromEntries(
    Object.values(DEFAULT_FILE_BY_FEATURE).map((filename) => [
      filename,
      {
        language: "vue" as const,
        content: readFileSync(join(showcaseRoot, "vue/src", filename), "utf8"),
      },
    ]),
  );
  return {
    files,
    defaultFileByFeature: { ...DEFAULT_FILE_BY_FEATURE },
  };
}
