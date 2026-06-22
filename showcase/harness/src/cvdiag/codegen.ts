/**
 * codegen.ts — derive `schema.json` (a JSON Schema document) from the
 * canonical TS schema. `schema.json` is the single IR consumed by the
 * per-language codegen stubs (Pydantic / .NET / Java / Go) in L0-C/D/E/F.
 *
 * Run via `bin/showcase cvdiag codegen` (→ `cmd-cvdiag-codegen.sh`) or directly
 * `npx tsx src/cvdiag/codegen.ts`. Writing `schema.json` MUST stay in lockstep
 * with `schema.ts`; CI checks for drift. Plan unit: L0-A.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCHEMA_VERSION,
  CVDIAG_LAYERS,
  CVDIAG_OUTCOMES,
  CVDIAG_BOUNDARIES,
  EDGE_HEADER_KEYS,
  ENVELOPE_KEYS,
  BOUNDARY_METADATA_KEYS,
  TEST_ID_REGEX,
} from "./schema.js";

/** A minimal JSON-Schema-shaped IR (draft 2020-12). */
export interface CvdiagJsonSchema {
  $schema: string;
  $id: string;
  title: string;
  schema_version: number;
  type: "object";
  required: string[];
  additionalProperties: false;
  properties: Record<string, unknown>;
  $defs: {
    layers: string[];
    outcomes: string[];
    boundaries: string[];
    edge_header_keys: string[];
    /** Closed metadata key sets per data-plane boundary. */
    boundary_metadata_keys: Record<string, readonly string[]>;
  };
}

/** Build the JSON Schema IR from the canonical TS constants. */
export function buildJsonSchema(): CvdiagJsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://copilotkit.ai/schemas/cvdiag/v1.json",
    title: "CVDIAG flap-observability envelope",
    schema_version: SCHEMA_VERSION,
    type: "object",
    required: ENVELOPE_KEYS.filter(
      (k) => k !== "_metadata_dropped" && k !== "_truncated",
    ),
    additionalProperties: false,
    properties: {
      schema_version: { type: "integer", const: SCHEMA_VERSION },
      test_id: { type: "string", pattern: TEST_ID_REGEX.source },
      trace_id: { type: "string" },
      span_id: { type: "string", pattern: "^[0-9a-f]{16}$" },
      parent_span_id: { type: ["string", "null"] },
      layer: { type: "string", enum: [...CVDIAG_LAYERS] },
      boundary: { type: "string", enum: [...CVDIAG_BOUNDARIES] },
      slug: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" },
      demo: { type: "string" },
      ts: { type: "string", format: "date-time" },
      mono_ns: { type: "integer" },
      duration_ms: { type: ["integer", "null"] },
      outcome: { type: "string", enum: [...CVDIAG_OUTCOMES] },
      edge_headers: {
        type: "object",
        additionalProperties: false,
        required: [...EDGE_HEADER_KEYS],
        properties: Object.fromEntries(
          EDGE_HEADER_KEYS.map((k) => [k, { type: ["string", "null"] }]),
        ),
      },
      metadata: { type: "object" },
      _metadata_dropped: { type: "boolean" },
      _truncated: { type: "boolean" },
    },
    $defs: {
      layers: [...CVDIAG_LAYERS],
      outcomes: [...CVDIAG_OUTCOMES],
      boundaries: [...CVDIAG_BOUNDARIES],
      edge_header_keys: [...EDGE_HEADER_KEYS],
      boundary_metadata_keys: BOUNDARY_METADATA_KEYS,
    },
  };
}

/** Serialize the JSON Schema IR (stable key order, 2-space indent + newline). */
export function serializeJsonSchema(): string {
  return `${JSON.stringify(buildJsonSchema(), null, 2)}\n`;
}

/** Resolve the on-disk path of the generated `schema.json` (alongside this). */
export function schemaJsonPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "schema.json");
}

/** Write `schema.json` to disk. Returns the path written. */
export function writeSchemaJson(): string {
  const path = schemaJsonPath();
  writeFileSync(path, serializeJsonSchema(), "utf8");
  return path;
}

/**
 * Drift check: returns `true` iff the on-disk `schema.json` matches what
 * `serializeJsonSchema()` would produce now. Used by `cvdiag-codegen --check`
 * in CI to fail on a stale `schema.json`.
 */
export function isSchemaJsonInSync(): boolean {
  let onDisk: string;
  try {
    onDisk = readFileSync(schemaJsonPath(), "utf8");
  } catch {
    return false;
  }
  return onDisk === serializeJsonSchema();
}

// When invoked directly (`tsx codegen.ts [--check]` / `node codegen.js`),
// either generate (default) or check for drift (`--check`, CI mode).
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  if (process.argv.includes("--check")) {
    if (isSchemaJsonInSync()) {
      // eslint-disable-next-line no-console
      console.log("CVDIAG codegen: schema.json is in sync with schema.ts");
    } else {
      // eslint-disable-next-line no-console
      console.error(
        "CVDIAG codegen: schema.json is STALE — run 'showcase cvdiag-codegen' and commit.",
      );
      process.exit(1);
    }
  } else {
    const path = writeSchemaJson();
    // eslint-disable-next-line no-console
    console.log(`CVDIAG codegen: wrote ${path}`);
  }
}
