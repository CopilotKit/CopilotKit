/**
 * cvdiag-emitter.ts — the SHARED TypeScript CVDIAG emitter binding that the
 * four TS-backed integrations import (langgraph-typescript, claude-sdk-typescript,
 * mastra, built-in-agent). Plan unit: L0-F. Spec: 2026-06-18-flap-observability
 * §5 (schema) + §6 (tiers / PII).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH — this file RE-EXPORTS, it does NOT redefine.
 *
 * The canonical CVDIAG schema, edge-header allow/deny filter, PII scrub, and
 * the `CvdiagEmitter` (tier resolution, fail-closed DEBUG guard, byte caps,
 * bounded queue, UUIDv7 span/test minters) all live in L0-A under
 * `showcase/harness/src/cvdiag/`. This binding is a thin barrel that pulls
 * those symbols forward so the TS integrations have ONE import surface and so
 * a schema change in L0-A propagates here automatically (no duplicate enum to
 * drift). Re-exporting (not duplicating) is the whole point of the unit: the
 * §5 "single source of truth" / "CI lint fails on drift" policy is only
 * enforceable if every emitter shares the L0-A definitions.
 *
 * The relative path `../../../harness/src/cvdiag/` resolves as:
 *   showcase/integrations/_shared/ts/  →  ../../../harness/src/cvdiag/
 *   ( _shared/ts → _shared → integrations → showcase )/harness/src/cvdiag
 * i.e. from this file up three levels to `showcase/`, then into `harness/`.
 * The `.js` extensions match L0-A's ESM (`"type": "module"`, bundler module
 * resolution) — at runtime under tsx / a bundler the `.js` specifier resolves
 * to the `.ts` source, exactly as the harness's own `index.ts` barrel does.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CROSS-CONTEXT RESOLUTION FOR L1-E (how a standalone TS integration's Docker
 * build sees these files):
 *
 *   Each TS integration (langgraph-typescript, claude-sdk-typescript, mastra)
 *   already vendors a sibling-directory `shared-tools/` into its build context
 *   via a `COPY shared-tools/ ./shared-tools/` line in its Dockerfile (the
 *   build context is the integration dir, so a sibling source tree is copied
 *   in as a top-level dir, NOT imported across the repo). L1-E MUST use the
 *   SAME mechanism for CVDIAG:
 *
 *     1. Stage `_shared/ts/cvdiag-emitter.ts` (this file, with the relative
 *        re-exports flattened to point at a co-located copy of the L0-A
 *        sources) AND the three L0-A sources it pulls from
 *        (`schema.ts`, `edge-headers.ts`, `emit.ts`) into the integration's
 *        build context — e.g. under `shared-tools/cvdiag/` or a dedicated
 *        `_cvdiag/` dir — exactly as `shared-tools/` is copied today.
 *     2. Add `COPY shared-tools/cvdiag/ ./shared-tools/cvdiag/` (or the chosen
 *        path) to each integration Dockerfile, mirroring the existing
 *        `COPY shared-tools/ ./shared-tools/` line.
 *     3. The integration's CVDIAG wiring imports
 *        `from "../../shared-tools/cvdiag/cvdiag-emitter"` (path per chosen
 *        layout) rather than reaching across the monorepo — standalone npm
 *        projects have no path alias back to `showcase/harness`.
 *
 *   This is the TS analogue of L0-C's Python `_shared/cvdiag_bootstrap`: a
 *   COPY-into-context staging step, NOT a workspace/path-alias import. Within
 *   THIS slot (the harness/worktree) the relative `../../../harness/...`
 *   re-export resolves directly so the vitest suite runs against the real L0-A
 *   sources; L1-E performs the COPY-staging flatten when packaging each
 *   integration. A `bin/showcase cvdiag stage-ts` helper (or the existing
 *   build wrapper) is the natural home for the copy, so the staging is a
 *   build step and not hand-maintained per integration.
 */

// ── Schema (types, enums, validators, UUIDv7 regex) ─────────────────────────
export {
  SCHEMA_VERSION,
  CVDIAG_LAYERS,
  CVDIAG_OUTCOMES,
  PROBE_BOUNDARIES,
  BACKEND_BOUNDARIES,
  AIMOCK_BOUNDARIES,
  CVDIAG_DATA_PLANE_BOUNDARIES,
  CVDIAG_ACCOUNTING_BOUNDARIES,
  CVDIAG_BOUNDARIES,
  EDGE_HEADER_KEYS,
  TERMINATION_KINDS,
  TEST_ID_REGEX,
  ENVELOPE_KEYS,
  BOUNDARY_METADATA_KEYS,
  isValidTestId,
  validateEnvelope,
  validateMetadata,
} from "../../../harness/src/cvdiag/schema.js";

export type {
  CvdiagLayer,
  CvdiagOutcome,
  CvdiagDataPlaneBoundary,
  CvdiagAccountingBoundary,
  CvdiagBoundary,
  EdgeHeaders,
  EdgeHeaderKey,
  TerminationKind,
  CvdiagEnvelope,
  EnvelopeValidationResult,
  MetadataValidationResult,
} from "../../../harness/src/cvdiag/schema.js";

// ── Edge-header allow/deny filter + PII scrub ───────────────────────────────
export {
  EDGE_HEADER_ALLOWLIST,
  EDGE_HEADER_DENYLIST,
  BEARER_TOKEN_REGEX,
  SK_KEY_REGEX,
  URL_USERINFO_REGEX,
  SCRUB_REPLACEMENT,
  scrubSecrets,
  filterEdgeHeaders,
} from "../../../harness/src/cvdiag/edge-headers.js";

// ── Emitter (tier resolution, fail-closed DEBUG, byte caps, span/id minters) ─
export {
  CvdiagEmitter,
  BYTE_CAP_BY_TIER,
  QUEUE_CAP,
  DEBUG_MAX_WALLCLOCK_MS,
  DEBUG_MAX_EVENTS,
  FLUSH_WINDOW_MS,
  resolveEnvLabel,
  mintTestId,
  mintSpanId,
} from "../../../harness/src/cvdiag/emit.js";

export type {
  CvdiagTier,
  CvdiagPbWriter,
  CvdiagEnv,
  CvdiagEmitterOptions,
  CvdiagEmitArgs,
} from "../../../harness/src/cvdiag/emit.js";

// ── Concrete writer-role PB writer (plain fetch; auth-with-password→Bearer) ──
export {
  CvdiagFetchPbWriter,
  createCvdiagFetchPbWriterFromEnv,
} from "../../../harness/src/cvdiag/pb-writer-fetch.js";

export type {
  FetchLike,
  CvdiagFetchPbWriterOptions,
} from "../../../harness/src/cvdiag/pb-writer-fetch.js";
