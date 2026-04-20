import data from "../../../shell/src/data/docs-status.json";

export type DocState = "ok" | "missing" | "notfound" | "error";

interface DocsStatusBundle {
  generated_at: string;
  features: Record<string, { og: DocState; shell: DocState }>;
}

const bundle = data as unknown as DocsStatusBundle;

export function getDocsStatus(featureId: string): {
  og: DocState;
  shell: DocState;
} {
  return bundle.features[featureId] ?? { og: "missing", shell: "missing" };
}
