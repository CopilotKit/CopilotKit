export interface SetupContentEntry {
  framework: string;
  concept: string;
  source: string;
}

export interface SetupContentBundle {
  version: 1;
  concepts: Record<string, SetupContentEntry>;
}

export function setupContentKey(framework: string, concept: string): string {
  return `${framework}::${concept}`;
}

const SETUP_CONTENT_FALLBACKS: Record<string, string[]> = {
  "langgraph-fastapi": ["langgraph-python"],
};

export function resolveBundledSetupConcept(
  framework: string,
  concept: string,
  bundle: SetupContentBundle,
): string | null {
  const candidates = [framework, ...(SETUP_CONTENT_FALLBACKS[framework] ?? [])];
  for (const candidate of candidates) {
    const source = bundle.concepts[setupContentKey(candidate, concept)]?.source;
    if (source !== undefined) return source;
  }
  return null;
}
