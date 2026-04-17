import type { FormField, FormSchema } from "./types";

export interface V1Parameter {
  name: string;
  type?: string;
  enum?: string[];
  required?: boolean;
  description?: string;
  attributes?: V1Parameter[];
}

function paramToField(p: V1Parameter): FormField {
  const required = p.required ?? true;
  const base = { name: p.name, label: p.name, required, description: p.description };

  if (p.type === "string") {
    return { kind: "string", ...base, enum: p.enum };
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
    const inner = p.type.slice(0, -2);
    const itemField = paramToField({ name: "item", type: inner, required: true });
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
