import { z } from "zod";
import { DIMENSIONS, type Dimension } from "../../types/index.js";

/**
 * Probe config Zod schema. Mirrors `src/rules/schema.ts` in style — closed
 * enums on anything a typo would silently break (here: `kind`), pass-through
 * on per-target detail fields so drivers can accept arbitrary YAML keys
 * without schema churn, and a strict union shape so EXACTLY ONE of
 * `targets` / `discovery` / `target` is present per probe config.
 *
 * Schedule strings are only shape-checked (`min(1)`); cron validity is
 * Croner's job when `scheduler.register` fires. Keeping the cron check
 * outside the loader mirrors how `rules/schema.ts` defers `cron_only.schedule`
 * validation to the scheduler — one source of truth for cron syntax.
 */

// `z.enum` wants a writable tuple at the type level; `DIMENSIONS` is
// `readonly` so we coerce to the expected tuple shape without widening
// the runtime value (same pattern as `rules/schema.ts:DimensionEnum`).
const ProbeKindEnum = z.enum(
  DIMENSIONS as unknown as readonly [Dimension, ...Dimension[]],
);

/**
 * Per-target entry for static probes. `key` is required (writer dedupe key);
 * `url` is common enough to standardize but drivers may accept additional
 * per-target fields — `passthrough()` lets `{ key, url, extra }` parse
 * cleanly. The driver's `inputSchema` is the authoritative per-target
 * validator at invoke time.
 */
const StaticTargetSchema = z
  .object({
    key: z.string().min(1),
    url: z.string().url().optional(),
  })
  .passthrough();

const DiscoveryBlockSchema = z
  .object({
    source: z.string().min(1),
    filter: z.record(z.unknown()).optional(),
    key_template: z.string().min(1),
  })
  .strict();

const SingleTargetSchema = z
  .object({
    key: z.string().min(1),
  })
  .passthrough();

const BaseFields = {
  kind: ProbeKindEnum,
  id: z.string().min(1),
  schedule: z.string().min(1),
  // 1_800_000ms (30 min) upper bound. The slowest user is `e2e-demos.yml`,
  // which ships with `timeout_ms: 1_200_000` (20 min) — its driver fans
  // out a Playwright matrix across every demo of every Railway service
  // (32-avg / 38-largest demos × 17 frameworks). The 30-min ceiling gives
  // ~10 min of headroom over today's slowest probe so a future slow-but-
  // still-reasonable budget addition doesn't push us back through this
  // file. The previous 900_000 (15 min) cap REJECTED `e2e-demos.yml` at
  // probe-loader parse-time — probe was dead-on-arrival in production
  // (the 845/847 unit-suite passed because probe-loader unit tests use
  // stub configs, not the real YAMLs). Keep the positive() / int()
  // guards — a negative or non-integer timeout is a typo, not a valid
  // long-running budget.
  timeout_ms: z.number().int().positive().max(1_800_000).optional(),
  /**
   * Max simultaneous per-target invocations per tick. Bounded [1, 32] —
   * smaller than 1 would deadlock; larger than 32 would risk stampeding
   * upstream registries (pypi/npm/GHCR) on a single tick. Default 4 is
   * the same bound image-drift used in the legacy bash loop.
   */
  max_concurrency: z.number().int().min(1).max(32).default(4),
};

const StaticProbeSchema = z
  .object({
    ...BaseFields,
    targets: z.array(StaticTargetSchema).min(1),
  })
  .strict();

const DiscoveryProbeSchema = z
  .object({
    ...BaseFields,
    discovery: DiscoveryBlockSchema,
  })
  .strict();

const SingleTargetProbeSchema = z
  .object({
    ...BaseFields,
    target: SingleTargetSchema,
  })
  .strict();

/**
 * Probe config union. Zod's `union` rejects values that don't match any
 * variant, so a config with both `targets` and `discovery` (or with none
 * of the three) fails at parse with a message enumerating the valid
 * shapes. `strict()` on each variant forbids unknown top-level keys so a
 * YAML typo like `tragets:` surfaces as "unrecognized key" rather than
 * silently fanning out to zero targets.
 */
export const ProbeConfigSchema = z.union([
  StaticProbeSchema,
  DiscoveryProbeSchema,
  SingleTargetProbeSchema,
]);

export type ProbeConfig = z.infer<typeof ProbeConfigSchema>;
export type StaticProbeConfig = z.infer<typeof StaticProbeSchema>;
export type DiscoveryProbeConfig = z.infer<typeof DiscoveryProbeSchema>;
export type SingleTargetProbeConfig = z.infer<typeof SingleTargetProbeSchema>;
