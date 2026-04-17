export interface SchemaHint {
  kind: "v1-params" | "standard-schema" | "none";
  payload: unknown;
}

export function extractSchemaHint(config: unknown): SchemaHint {
  const p = (config as { parameters?: unknown } | null)?.parameters;
  if (Array.isArray(p)) return { kind: "v1-params", payload: p };
  if (p && typeof p === "object" && "~standard" in p) {
    return { kind: "standard-schema", payload: p };
  }
  return { kind: "none", payload: null };
}
