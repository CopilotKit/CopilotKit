import { v1ParametersToFormSchema, type V1Parameter } from "./v1-params";
import { standardSchemaToFormSchema } from "./standard-schema";
import type { FormSchema } from "./types";

/**
 * Derives a FormSchema from a captured hook config's `.parameters` field.
 *
 * Most render hooks declare their parameter shape on the config object:
 *  - V1 `useCopilotAction`: `parameters: V1Parameter[]`
 *  - V2 `useRenderTool` / `useFrontendTool`: `parameters: StandardSchemaV1`
 *    (typically a Zod schema)
 *
 * This function is the runtime counterpart to `extractSchemaHint` in the
 * extension host: same detection rules, but consumed directly in the webview
 * where the captured config lives.
 */
export function inferFormSchemaFromConfig(
  config: { parameters?: unknown } | null | undefined,
): FormSchema {
  const params = config?.parameters;
  if (Array.isArray(params)) {
    return v1ParametersToFormSchema(params as V1Parameter[]);
  }
  if (params && typeof params === "object" && "~standard" in params) {
    return standardSchemaToFormSchema(params);
  }
  return { fields: [] };
}
