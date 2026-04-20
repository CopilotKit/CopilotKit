import type { FormField, FormSchema } from "./types";

export interface V1Parameter {
  name: string;
  type?: string;
  enum?: string[];
  required?: boolean;
  description?: string;
  attributes?: V1Parameter[];
}

function baseFor(p: V1Parameter, required: boolean) {
  const out: {
    name: string;
    label: string;
    required: boolean;
    description?: string;
  } = {
    name: p.name,
    label: p.name,
    required,
  };
  if (p.description !== undefined) out.description = p.description;
  return out;
}

function paramToField(p: V1Parameter): FormField {
  const required = p.required ?? true;
  const base = baseFor(p, required);

  if (p.type === "string") {
    const field: Extract<FormField, { kind: "string" }> = {
      kind: "string",
      ...base,
    };
    if (p.enum !== undefined) field.enum = p.enum;
    return field;
  }
  if (p.type === "number") return { kind: "number", ...base };
  if (p.type === "boolean") return { kind: "boolean", ...base };
  if (p.type === "object") {
    return {
      kind: "object",
      ...base,
      fields: (p.attributes ?? []).map(paramToField),
    };
  }
  if (p.type?.endsWith("[]")) {
    // Strip the trailing "[]" and recurse. This lets nested arrays like
    // `string[][]` resolve layer-by-layer rather than collapsing to raw-json.
    const inner = p.type.slice(0, -2);
    const itemField = paramToField({
      name: "item",
      type: inner,
      required: true,
    });
    return { kind: "array", ...base, items: itemField };
  }
  return {
    kind: "raw-json",
    ...base,
    hint: `Unknown parameter type "${p.type ?? "(none)"}"; edit as JSON.`,
  };
}

export function v1ParametersToFormSchema(
  parameters: V1Parameter[] | undefined,
): FormSchema {
  return { fields: (parameters ?? []).map(paramToField) };
}
