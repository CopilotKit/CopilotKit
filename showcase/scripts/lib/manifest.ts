/**
 * Shared manifest schema + parser.
 *
 * Used by audit.ts, validate-parity.ts, and validate-pins.ts so the
 * three tools agree on:
 *   1. the Manifest / ManifestDemo TypeScript shape
 *   2. runtime shape validation of `manifest.yaml`
 *   3. the tagged-union return type distinguishing missing /
 *      malformed / unreadable / ok
 *
 * Prior to extraction, each script reimplemented this slightly
 * differently — e.g. audit.ts guarded against `yaml.parse → null` but
 * validate-parity.ts did not, and none of them verified `demos` was
 * actually an array of objects with string `id` fields. The resulting
 * `yaml.parse(raw) as Manifest` cast could silently propagate invalid
 * shapes into the rest of each tool.
 */

import fs from "fs";
import yaml from "yaml";

/**
 * One entry under `manifest.yaml :: demos[]`. Name is optional; id is
 * required (checked at runtime by parseManifest).
 */
export interface ManifestDemo {
  id: string;
  name?: string;
}

/**
 * Union of the fields used by audit.ts / validate-parity.ts / validate-pins.ts.
 * Only `slug` is truly always present in practice, but the three
 * validators already tolerated missing slug / name / deployed, so we keep
 * them optional here for backwards compatibility.
 */
export interface Manifest {
  slug?: string;
  name?: string;
  deployed?: boolean;
  demos?: ManifestDemo[];
}

/**
 * Tagged union of manifest parse outcomes. Callers discriminate on
 * `kind`:
 *
 *   - "missing"    — manifest.yaml does not exist on disk
 *   - "malformed"  — file exists but its contents do not round-trip
 *                    to a valid Manifest (YAML parse error, null/scalar
 *                    top-level, non-array demos, demo missing id, etc.)
 *   - "unreadable" — file exists but readFileSync threw
 *                    (permissions, I/O race, etc.)
 *   - "ok"         — parse succeeded and shape validated
 */
export type ParsedManifest =
  | { kind: "ok"; manifest: Manifest }
  | { kind: "missing" }
  | { kind: "malformed"; error: string }
  | { kind: "unreadable"; error: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Read + parse + validate a manifest.yaml at `filePath`. Returns a
 * tagged-union `ParsedManifest`; never throws for content errors.
 *
 * The shape checks are intentionally strict:
 *   - top-level must be a plain object mapping (not null, scalar, or
 *     array) — otherwise downstream `.demos` / `.deployed` reads would
 *     TypeError at runtime;
 *   - `demos`, if present, must be an array of objects each with a
 *     string `id`;
 *   - `deployed`, if present, must be a boolean (YAML `"yes"` parses to
 *     a string, which old code silently treated as truthy — classic
 *     footgun).
 *
 * Any failure produces `{ kind: "malformed", error }` with a
 * human-readable reason. Missing files produce `{ kind: "missing" }`
 * (distinct from malformed so callers can emit different anomalies).
 * Read errors (EACCES etc.) produce `{ kind: "unreadable" }` — we do
 * NOT collapse them into malformed because the file's contents are not
 * actually known to be invalid.
 */
export function parseManifest(filePath: string): ParsedManifest {
  if (!fs.existsSync(filePath)) return { kind: "missing" };

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    return { kind: "unreadable", error: errMsg(e) };
  }

  let parsed: unknown;
  try {
    parsed = yaml.parse(raw);
  } catch (e) {
    return { kind: "malformed", error: errMsg(e) };
  }

  // Top-level type guard. yaml.parse("") is null and yaml.parse("42") is
  // 42 — neither is a manifest. Arrays also aren't valid (manifest.yaml
  // is a mapping).
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      kind: "malformed",
      error: `expected YAML object at top level, got ${
        parsed === null
          ? "null (empty file?)"
          : Array.isArray(parsed)
            ? "array"
            : typeof parsed
      }`,
    };
  }

  const obj = parsed as Record<string, unknown>;

  // deployed (optional) must be a real boolean if present.
  if ("deployed" in obj && typeof obj.deployed !== "boolean") {
    return {
      kind: "malformed",
      error: `expected "deployed" to be boolean, got ${typeof obj.deployed}`,
    };
  }

  // demos (optional) must be an array of objects with string id.
  if ("demos" in obj && obj.demos !== undefined) {
    if (!Array.isArray(obj.demos)) {
      return {
        kind: "malformed",
        error: `expected "demos" to be an array, got ${typeof obj.demos}`,
      };
    }
    for (let i = 0; i < obj.demos.length; i++) {
      const d = obj.demos[i];
      if (d === null || typeof d !== "object" || Array.isArray(d)) {
        return {
          kind: "malformed",
          error: `expected demos[${i}] to be an object, got ${
            d === null ? "null" : Array.isArray(d) ? "array" : typeof d
          }`,
        };
      }
      const dm = d as Record<string, unknown>;
      if (typeof dm.id !== "string" || dm.id.length === 0) {
        return {
          kind: "malformed",
          error: `expected demos[${i}].id to be a non-empty string`,
        };
      }
    }
  }

  return { kind: "ok", manifest: obj as Manifest };
}
