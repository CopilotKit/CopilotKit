import { jsonrepair } from "jsonrepair";

const OPERATIONS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
  "callRendererFunction",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether a value is shaped like one A2UI 1.0 operation: "version" and
 * exactly one operation with a surfaceId, and every component with an id
 * and a component name. It checks the shape only; the client still
 * validates the props.
 */
export function isOperationShape(value: unknown): boolean {
  if (!isRecord(value) || value.version !== "v1.0") return false;
  const names = OPERATIONS.filter((name) => name in value);
  if (names.length !== 1 || Object.keys(value).length !== 2) return false;
  const body = value[names[0]];
  if (!isRecord(body)) return false;
  if (names[0] === "callRendererFunction") return true;
  if (typeof body.surfaceId !== "string") return false;
  const components = body.components;
  if (components === undefined) return true;
  return (
    Array.isArray(components) &&
    components.every(
      (c) =>
        isRecord(c) &&
        typeof c.id === "string" &&
        typeof c.component === "string",
    )
  );
}

/**
 * The reply with its broken a2ui fence lines repaired: a line that is not
 * valid JSON goes through jsonrepair, and the result replaces it only when
 * it is shaped like an operation. Lines that cannot be repaired stay as
 * they are, so the client drops them as before. `repaired` lists the
 * original lines that were replaced.
 */
export function repairFences(text: string): {
  text: string;
  repaired: string[];
} {
  const repaired: string[] = [];
  const out = text.replace(
    /(```a2ui[^\n]*\n)([\s\S]*?)(```)/g,
    (_match, open: string, body: string, close: string) => {
      const lines = body.split("\n").map((line) => {
        if (!line.trim()) return line;
        try {
          JSON.parse(line);
          return line;
        } catch {
          // Not valid JSON: try a repair below.
        }
        try {
          const value: unknown = JSON.parse(jsonrepair(line));
          if (!isOperationShape(value)) return line;
          repaired.push(line);
          return JSON.stringify(value);
        } catch {
          return line;
        }
      });
      return `${open}${lines.join("\n")}${close}`;
    },
  );
  return { text: out, repaired };
}
