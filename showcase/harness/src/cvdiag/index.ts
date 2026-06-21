/**
 * index.ts — barrel re-export for the CVDIAG flap-observability foundation
 * (L0-A). Downstream slots import the schema types, edge-header filter, and
 * emitter from here. The JSON Schema (`schema.json`) is the codegen IR for the
 * per-language bindings (L0-C/D/E/F); see `cmd-cvdiag-codegen.sh`.
 */

export * from "./schema.js";
export * from "./edge-headers.js";
export * from "./emit.js";
export * from "./pb-writer-fetch.js";
