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
 *
 * `slug` is REQUIRED: every manifest in showcase/packages/ carries a
 * slug, and none of the three consumers ever constructs or accepts a
 * Manifest without one. Marking it required here lets downstream code
 * drop `manifest.slug ?? "(unknown)"` fallbacks without TypeScript
 * complaining. parseManifest enforces `slug` is a non-empty string at
 * runtime, so the type matches reality.
 *
 * `name`, `deployed`, and `demos` remain optional: in practice not every
 * manifest sets `name`, and `deployed`/`demos` only appear when
 * meaningful.
 */
export interface Manifest {
  slug: string;
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
 *                    to a valid Manifest. Further split on `subkind`:
 *                    "syntax" = YAML parser rejected the text outright
 *                               (unterminated arrays, bad indentation);
 *                    "shape"  = YAML parsed but the resulting value
 *                               does not match the Manifest shape
 *                               (null/scalar top-level, non-array demos,
 *                               demo missing id, etc.)
 *   - "unreadable" — file exists but readFileSync threw
 *                    (permissions, I/O race, etc.)
 *   - "ok"         — parse succeeded and shape validated
 */
export type ParsedManifest =
  | { kind: "ok"; manifest: Manifest }
  | { kind: "missing" }
  | { kind: "malformed"; subkind: "syntax" | "shape"; error: string }
  | { kind: "unreadable"; error: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Describe a value for error messages. Distinguishes null/array from
 * plain `typeof` because `typeof null === "object"` and
 * `typeof [] === "object"` both hide the real shape from users.
 */
function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Read + parse + validate a manifest.yaml at `filePath`. Returns a
 * tagged-union `ParsedManifest`; never throws for content errors.
 *
 * The shape checks are intentionally strict:
 *   - top-level must be a plain object mapping (not null, scalar, or
 *     array) — otherwise downstream `.demos` / `.deployed` reads would
 *     TypeError at runtime;
 *   - `slug` must be a non-empty string (the three consumers all rely
 *     on it — missing slug is always a bug);
 *   - `name`, if present, must be a string;
 *   - `demos`, if present, must be an array of objects each with a
 *     string `id`;
 *   - `deployed`, if present, must be a boolean (YAML `"yes"` parses to
 *     a string, which old code silently treated as truthy — classic
 *     footgun).
 *
 * Any shape failure produces
 * `{ kind: "malformed", subkind: "shape", error }` with a
 * human-readable reason. YAML parser failures produce
 * `{ kind: "malformed", subkind: "syntax", error }` (distinct so CI can
 * route syntax errors differently from schema-drift errors). Missing
 * files produce `{ kind: "missing" }` (distinct from malformed so
 * callers can emit different anomalies). Read errors (EACCES etc.)
 * produce `{ kind: "unreadable" }` — we do NOT collapse them into
 * malformed because the file's contents are not actually known to be
 * invalid.
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
    return { kind: "malformed", subkind: "syntax", error: errMsg(e) };
  }

  // Top-level type guard. yaml.parse("") is null and yaml.parse("42") is
  // 42 — neither is a manifest. Arrays also aren't valid (manifest.yaml
  // is a mapping).
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      kind: "malformed",
      subkind: "shape",
      error: `expected YAML object at top level, got ${
        parsed === null ? "null (empty file?)" : describeType(parsed)
      }`,
    };
  }

  const obj = parsed as Record<string, unknown>;

  // slug is required — every consumer (audit.ts / validate-parity.ts /
  // validate-pins.ts) assumes a slug exists. A manifest without one is
  // always a bug, not a tolerable edge case.
  if (typeof obj.slug !== "string" || obj.slug.length === 0) {
    return {
      kind: "malformed",
      subkind: "shape",
      error:
        obj.slug === undefined
          ? `missing required "slug" (non-empty string)`
          : `expected "slug" to be a non-empty string, got ${describeType(obj.slug)}`,
    };
  }

  // name (optional) must be a string if present.
  if ("name" in obj && obj.name !== undefined && typeof obj.name !== "string") {
    return {
      kind: "malformed",
      subkind: "shape",
      error: `expected "name" to be a string, got ${describeType(obj.name)}`,
    };
  }

  // deployed (optional) must be a real boolean if present.
  if ("deployed" in obj && typeof obj.deployed !== "boolean") {
    return {
      kind: "malformed",
      subkind: "shape",
      error: `expected "deployed" to be boolean, got ${describeType(obj.deployed)}`,
    };
  }

  // demos (optional) must be an array of objects with string id.
  // `obj.demos != null` is deliberate: it covers both `undefined` (key
  // absent or explicitly undefined) and `null` (YAML `demos:` with no
  // value), treating both as "not provided". If the key is present with
  // a non-nullish value that is not an array, fall through and report.
  if (obj.demos != null) {
    if (!Array.isArray(obj.demos)) {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "demos" to be an array, got ${describeType(obj.demos)}`,
      };
    }
    for (let i = 0; i < obj.demos.length; i++) {
      const d = obj.demos[i];
      if (d === null || typeof d !== "object" || Array.isArray(d)) {
        return {
          kind: "malformed",
          subkind: "shape",
          error: `expected demos[${i}] to be an object, got ${describeType(d)}`,
        };
      }
      const dm = d as Record<string, unknown>;
      if (typeof dm.id !== "string" || dm.id.length === 0) {
        return {
          kind: "malformed",
          subkind: "shape",
          error: `expected demos[${i}].id to be a non-empty string`,
        };
      }
    }
  }

  // By the time we reach here all fields have been validated individually
  // (slug is a non-empty string, name/deployed/demos match their declared
  // shape). The compiler cannot narrow `obj: Record<string, unknown>` to
  // `Manifest` through those runtime guards, so an `as unknown as
  // Manifest` indirection is required — this is the one place in the
  // module that crosses the validation boundary.
  return { kind: "ok", manifest: obj as unknown as Manifest };
}
