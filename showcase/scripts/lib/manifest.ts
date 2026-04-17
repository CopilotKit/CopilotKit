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
 * Branded, non-empty demo id. Structurally a string (so downstream
 * callers can still use `demo.id` in template strings, `Set<string>`
 * membership, equality comparisons, etc.) but the branding prevents
 * arbitrary strings from flowing into a `DemoId` slot without going
 * through the `createDemoId` smart constructor. parseManifest is the
 * sole production caller of that constructor; it validates non-empty
 * at runtime and re-reports shape-malformed on failure.
 *
 * The `__brand` property is phantom-only — it does not exist at
 * runtime. That keeps the branded type zero-cost while still giving
 * the compiler a distinct nominal type for id values.
 */
export type DemoId = string & { readonly __brand: "DemoId" };

/**
 * Smart constructor for `DemoId`. Returns the branded value on success
 * or `null` if validation fails (currently: empty string). Kept as
 * `null`-returning rather than throwing so `parseManifest` can turn a
 * failure into its usual `{kind:"malformed", subkind:"shape"}` result
 * without crossing an exception boundary.
 */
export function createDemoId(s: string): DemoId | null {
  if (typeof s !== "string" || s.length === 0) return null;
  return s as DemoId;
}

/**
 * One entry under `manifest.yaml :: demos[]`. Name is optional; id is
 * required AND non-empty (checked at runtime by parseManifest, typed
 * via the `DemoId` brand).
 */
export interface ManifestDemo {
  id: DemoId;
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
 *                               demo missing id, duplicate demo id, etc.)
 *   - "unreadable" — file exists but readFileSync threw
 *                    (permissions, I/O race, etc.)
 *   - "ok"         — parse succeeded and shape validated
 *
 * The `subkind` discriminator on "malformed" lets callers route each
 * failure mode distinctly: a "syntax" subkind flags a likely typo in
 * the YAML source, whereas "shape" flags a schema-drift / validation
 * problem (missing required field, wrong type, duplicate id, etc.).
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
 * `Object.hasOwn`-backed predicate that narrows `obj` to a type where
 * `key` is known to exist. Preferred over `(obj as Record<string,
 * unknown>)[key]` casts because:
 *
 *   - the TS predicate lets the caller read `obj[key]` without any
 *     further cast;
 *   - `Object.hasOwn` avoids the inherited-property pitfalls of the
 *     raw `in` operator for YAML-parsed objects (yaml v2 returns plain
 *     objects with a null prototype, but inheriting tests written
 *     elsewhere might not).
 */
function hasOwnProp<K extends string>(
  obj: object,
  key: K,
): obj is object & Record<K, unknown> {
  return Object.hasOwn(obj, key);
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

  // At this point `parsed` is known to be a plain object mapping. We
  // narrow each field access through `hasOwnProp` so the compiler does
  // not need a blanket `as Record<string, unknown>` cast — every read
  // below is narrowed by the predicate it just passed.
  const obj: object = parsed;

  // slug is required — every consumer (audit.ts / validate-parity.ts /
  // validate-pins.ts) assumes a slug exists. A manifest without one is
  // always a bug, not a tolerable edge case.
  if (!hasOwnProp(obj, "slug")) {
    return {
      kind: "malformed",
      subkind: "shape",
      error: `missing required "slug" (non-empty string)`,
    };
  }
  const slug = obj.slug;
  if (typeof slug !== "string" || slug.length === 0) {
    return {
      kind: "malformed",
      subkind: "shape",
      error:
        slug === undefined
          ? `missing required "slug" (non-empty string)`
          : `expected "slug" to be a non-empty string, got ${describeType(slug)}`,
    };
  }

  // name (optional) must be a string if present.
  let name: string | undefined;
  if (hasOwnProp(obj, "name") && obj.name !== undefined) {
    if (typeof obj.name !== "string") {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "name" to be a string, got ${describeType(obj.name)}`,
      };
    }
    name = obj.name;
  }

  // deployed (optional) must be a real boolean if present.
  let deployed: boolean | undefined;
  if (hasOwnProp(obj, "deployed")) {
    if (typeof obj.deployed !== "boolean") {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "deployed" to be boolean, got ${describeType(obj.deployed)}`,
      };
    }
    deployed = obj.deployed;
  }

  // demos (optional) must be an array of objects with non-empty string id.
  // Treat both missing (`undefined`) and explicit null (YAML `demos:`)
  // as "not provided". If the key is present with a non-nullish value
  // that is not an array, fall through and report.
  let demos: ManifestDemo[] | undefined;
  if (hasOwnProp(obj, "demos") && obj.demos != null) {
    const rawDemos = obj.demos;
    if (!Array.isArray(rawDemos)) {
      return {
        kind: "malformed",
        subkind: "shape",
        error: `expected "demos" to be an array, got ${describeType(rawDemos)}`,
      };
    }
    const validated: ManifestDemo[] = [];
    // Duplicate-id detection: two demos with the same id cascade into
    // double-counted coverage and double missing-demo-dir anomalies
    // downstream. Reject at validation time so the error surfaces at
    // the manifest, not at the consuming tool.
    const seen = new Set<string>();
    for (let i = 0; i < rawDemos.length; i++) {
      const d: unknown = rawDemos[i];
      if (d === null || typeof d !== "object" || Array.isArray(d)) {
        return {
          kind: "malformed",
          subkind: "shape",
          error: `expected demos[${i}] to be an object, got ${describeType(d)}`,
        };
      }
      if (!hasOwnProp(d, "id") || typeof d.id !== "string") {
        return {
          kind: "malformed",
          subkind: "shape",
          error: `expected demos[${i}].id to be a non-empty string`,
        };
      }
      const brandedId = createDemoId(d.id);
      if (brandedId === null) {
        return {
          kind: "malformed",
          subkind: "shape",
          error: `expected demos[${i}].id to be a non-empty string`,
        };
      }
      if (seen.has(brandedId)) {
        return {
          kind: "malformed",
          subkind: "shape",
          error: `duplicate demo id "${brandedId}" at demos[${i}]`,
        };
      }
      seen.add(brandedId);
      // name is optional on a demo; only surface it if the source object
      // actually carries it. We don't validate its type here because
      // `ManifestDemo.name` is `string | undefined` and callers treat
      // non-strings as a non-fatal display problem; parseManifest keeps
      // its strict contract on `id` (the field callers actually key on).
      const demoName: string | undefined =
        hasOwnProp(d, "name") && typeof d.name === "string"
          ? d.name
          : undefined;
      validated.push(
        demoName === undefined
          ? { id: brandedId }
          : { id: brandedId, name: demoName },
      );
    }
    demos = validated;
  }

  // Construct the result field-by-field from the narrowed locals so
  // there is no `as unknown as Manifest` double-cast crossing the
  // validation boundary. Each field below was checked individually
  // above; the compiler tracks the narrowed type through the local
  // bindings, so this object literal typechecks against Manifest
  // without any casts.
  const manifest: Manifest =
    demos === undefined
      ? {
          slug,
          ...(name !== undefined ? { name } : {}),
          ...(deployed !== undefined ? { deployed } : {}),
        }
      : {
          slug,
          ...(name !== undefined ? { name } : {}),
          ...(deployed !== undefined ? { deployed } : {}),
          demos,
        };
  return { kind: "ok", manifest };
}
