import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const A2UI_OPERATIONS_KEY = "a2ui_operations";
export const BASIC_CATALOG_ID = "copilotkit://basic-catalog";

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

export async function loadSchema(relativePath: string): Promise<unknown[]> {
  const full = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(__dirname, relativePath);
  const raw = await fs.readFile(full, "utf8");
  return JSON.parse(raw) as unknown[];
}
