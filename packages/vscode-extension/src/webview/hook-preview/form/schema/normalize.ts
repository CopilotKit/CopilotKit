import type { FormField, FormSchema } from "./types";

export function defaultForField(f: FormField): unknown {
  if (!f.required) return undefined;
  switch (f.kind) {
    case "string":
      return f.enum?.[0] ?? "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return defaultsForFields(f.fields);
    case "raw-json":
      return {};
  }
}

function defaultsForFields(fields: FormField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = defaultForField(f);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

export function defaultsForSchema(schema: FormSchema): Record<string, unknown> {
  return defaultsForFields(schema.fields);
}

function matchesKind(field: FormField, value: unknown): boolean {
  switch (field.kind) {
    case "string":
      if (typeof value !== "string") return false;
      if (field.enum) return field.enum.includes(value);
      return true;
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "raw-json":
      return true;
  }
}

export function mergeValues(
  schema: FormSchema,
  prior: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const defaults = defaultsForSchema(schema);
  if (!prior) return defaults;
  const merged: Record<string, unknown> = { ...defaults };
  for (const f of schema.fields) {
    if (f.name in prior && matchesKind(f, prior[f.name])) {
      merged[f.name] = prior[f.name];
    }
  }
  return merged;
}
