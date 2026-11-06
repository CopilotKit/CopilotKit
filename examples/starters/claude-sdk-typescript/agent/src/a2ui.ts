import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const A2UI_OPERATIONS_KEY = "a2ui_operations";
export const BASIC_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

export type A2UIOperation = Record<string, unknown>;

export function createSurface(
  surfaceId: string,
  catalogId: string = BASIC_CATALOG_ID,
): A2UIOperation {
  return {
    version: "v0.9",
    createSurface: { surfaceId, catalogId },
  };
}

export function updateComponents(
  surfaceId: string,
  components: unknown[],
): A2UIOperation {
  return {
    version: "v0.9",
    updateComponents: { surfaceId, components },
  };
}

export function updateDataModel(
  surfaceId: string,
  value: unknown,
  p: string = "/",
): A2UIOperation {
  return {
    version: "v0.9",
    updateDataModel: { surfaceId, path: p, value },
  };
}

export function render(operations: A2UIOperation[]): string {
  return JSON.stringify({ [A2UI_OPERATIONS_KEY]: operations });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load an A2UI component schema (a JSON array) relative to this module —
// mirrors the copilotkit SDK's `a2ui.load_schema` used by the Python starter.
export function loadSchema(relativePath: string): unknown[] {
  const full = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(__dirname, relativePath);
  return JSON.parse(readFileSync(full, "utf8")) as unknown[];
}
