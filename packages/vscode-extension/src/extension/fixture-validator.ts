import { parseSync } from "oxc-parser";
import type { A2UIFixture, ValidationResult } from "./types";

interface FixtureParseResult {
  valid: boolean;
  fixtures?: Record<string, A2UIFixture>;
  errors: Array<{ message: string; line?: number; column?: number }>;
}

export function parseFixtureJson(content: string): FixtureParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      valid: false,
      errors: [{ message: "Invalid JSON" }],
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      valid: false,
      errors: [{ message: "Fixture file must be a JSON object" }],
    };
  }

  const errors: FixtureParseResult["errors"] = [];
  const fixtures: Record<string, A2UIFixture> = {};
  const entries = Object.entries(parsed as Record<string, unknown>);

  for (const [name, value] of entries) {
    if (typeof value !== "object" || value === null) {
      errors.push({ message: `Fixture "${name}" must be an object` });
      continue;
    }

    const fixture = value as Record<string, unknown>;

    if (typeof fixture.surfaceId !== "string") {
      errors.push({
        message: `Fixture "${name}" is missing required field "surfaceId" (string)`,
      });
      continue;
    }

    if (!Array.isArray(fixture.messages)) {
      errors.push({
        message: `Fixture "${name}" is missing required field "messages" (array)`,
      });
      continue;
    }

    fixtures[name] = {
      surfaceId: fixture.surfaceId,
      messages: fixture.messages,
    };
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, fixtures, errors: [] };
}

export function validateFixture(
  filePath: string,
  code: string,
): ValidationResult {
  const lang = filePath.endsWith(".tsx")
    ? "tsx"
    : filePath.endsWith(".ts")
      ? "ts"
      : "js";

  const result = parseSync(filePath, code, {
    lang,
    sourceType: "module",
  });

  if (result.errors.length > 0) {
    return {
      valid: false,
      errors: result.errors.map((e) => ({
        message: typeof e === "string" ? e : (e.message ?? String(e)),
      })),
    };
  }

  // Check for default export using actual oxc-parser API:
  // result.module.staticExports[].entries[].exportName.kind === "Default"
  const hasDefaultExport = result.module.staticExports.some((exp) =>
    exp.entries.some((entry) => entry.exportName.kind === "Default"),
  );

  if (!hasDefaultExport) {
    return {
      valid: false,
      errors: [
        {
          message:
            "Fixture file must have a default export (e.g. export default { ... })",
        },
      ],
    };
  }

  return { valid: true, errors: [] };
}
