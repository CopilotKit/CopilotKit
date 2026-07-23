import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logger.js";

const log = createLogger({ component: "fixtures" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(__dirname, "../../..");
const AIMOCK_DIR = path.join(SHOWCASE_DIR, "aimock");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FixtureEntry {
  match?: Record<string, unknown>;
  response?: Record<string, unknown>;
}

interface FixtureFile {
  fixtures?: FixtureEntry[];
}

interface ValidationError {
  file: string;
  message: string;
}

export interface ValidationReport {
  ok: number;
  errors: ValidationError[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate all fixture JSON files under showcase/aimock/.
 *
 * Checks:
 *   - Valid JSON parsing
 *   - Required top-level `fixtures` array
 *   - Each entry has `match` and `response` fields
 *   - No duplicate sequence keys (userMessage + turnIndex combos)
 */
export function fixturesValidate(): ValidationReport {
  const report: ValidationReport = { ok: 0, errors: [] };

  if (!fs.existsSync(AIMOCK_DIR)) {
    report.errors.push({
      file: AIMOCK_DIR,
      message: "aimock directory not found",
    });
    return report;
  }

  const jsonFiles = fs
    .readdirSync(AIMOCK_DIR)
    .filter((f) => f.endsWith(".json"));

  if (jsonFiles.length === 0) {
    log.warn("no JSON fixture files found", { dir: AIMOCK_DIR });
    return report;
  }

  for (const file of jsonFiles) {
    const filePath = path.join(AIMOCK_DIR, file);

    // 1. Valid JSON?
    let parsed: FixtureFile;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      parsed = JSON.parse(raw) as FixtureFile;
    } catch (err) {
      report.errors.push({
        file,
        message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // 2. Has fixtures array?
    if (!Array.isArray(parsed.fixtures)) {
      report.errors.push({
        file,
        message: 'Missing or non-array "fixtures" field',
      });
      continue;
    }

    // 3. Validate each entry and track sequence keys for duplicates
    const seenKeys = new Set<string>();
    let fileOk = true;

    for (let i = 0; i < parsed.fixtures.length; i++) {
      const entry = parsed.fixtures[i];

      if (!entry.match || typeof entry.match !== "object") {
        report.errors.push({
          file,
          message: `fixtures[${i}]: missing or invalid "match" field`,
        });
        fileOk = false;
        continue;
      }

      if (!entry.response || typeof entry.response !== "object") {
        report.errors.push({
          file,
          message: `fixtures[${i}]: missing or invalid "response" field`,
        });
        fileOk = false;
        continue;
      }

      // 4. Check for duplicate sequence keys (userMessage + turnIndex)
      const userMessage = entry.match.userMessage;
      const turnIndex = entry.match.turnIndex;
      const toolCallId = entry.match.toolCallId;

      let seqKey: string | null = null;
      if (typeof userMessage === "string") {
        seqKey =
          turnIndex !== undefined
            ? `msg:${userMessage}@turn:${turnIndex}`
            : `msg:${userMessage}`;
      } else if (typeof toolCallId === "string") {
        seqKey = `toolCallId:${toolCallId}`;
      }

      if (seqKey !== null) {
        if (seenKeys.has(seqKey)) {
          report.errors.push({
            file,
            message: `fixtures[${i}]: duplicate sequence key "${seqKey}"`,
          });
          fileOk = false;
        } else {
          seenKeys.add(seqKey);
        }
      }
    }

    if (fileOk) {
      report.ok++;
    }
  }

  return report;
}

/**
 * Format a validation report as a human-readable string.
 */
export function formatReport(report: ValidationReport): string {
  const lines: string[] = [];

  lines.push(
    `\n  Fixture validation: ${report.ok} OK, ${report.errors.length} error(s)`,
  );

  if (report.errors.length > 0) {
    lines.push("");
    for (const err of report.errors) {
      lines.push(`  \x1b[31m✗\x1b[0m ${err.file}: ${err.message}`);
    }
  } else {
    lines.push("  \x1b[32m✓ All fixture files valid\x1b[0m");
  }

  return lines.join("\n");
}
