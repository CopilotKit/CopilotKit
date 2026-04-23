import { z } from "zod";
import { DIMENSIONS, type Dimension } from "../types/index.js";

export const SeverityEnum = z.enum(["info", "warn", "error", "critical"]);

/**
 * R25 A1: closed enum over the known dimensions. Derived from the
 * `DIMENSIONS` literal array in `../types/index.ts` so this schema and the
 * `Dimension` type can never drift. A rule YAML with a typoed dimension
 * (e.g. `"smokee"`) is rejected at load with Zod's standard enum message
 * listing the valid members — pre-fix this passed `z.string().min(1)` and
 * silently never matched any probe key.
 */
// `z.enum` wants a writable tuple at the type level; `DIMENSIONS` is
// `readonly` so we coerce to the expected tuple shape without widening
// the runtime value. No `as any` — the cast is structural, not value-erasing.
export const DimensionEnum = z.enum(
  DIMENSIONS as unknown as readonly [Dimension, ...Dimension[]],
);

export const StringTriggerEnum = z.enum([
  "green_to_red",
  "red_to_green",
  "sustained_red",
  "sustained_green",
  "first",
  "set_changed",
  "cancelled_prebuild",
  "cancelled_midmatrix",
  "stable",
  "regressed",
  "improved",
  "set_drifted",
  // set_errored: fires when a probe reports a non-empty `signal.errored`
  // list. Used by invariant probes (e.g. aimock-wiring) where a pure-errored
  // tick emits `state:"red"` but neither `set_drifted` (no unwired bucket)
  // nor `red_to_green` (transitioning OUT of errored). Without this the
  // rule silently collapses onto the bare state-machine transition and the
  // "errored services" block in the template never renders.
  "set_errored",
  // gate_skipped: HF13-E1 coord. The showcase_deploy.yml notify-ops step
  // posts a `gateSkipped: true` payload when the lockfile/detect-changes
  // gate blocks the build matrix before any service deploys. That payload
  // resolves to state="green" (failedCount=0) in the deploy-result probe,
  // so no state-machine transition fires and the rule would silently drop
  // the tick. This flag is derived from `signal.gateSkipped === true` in
  // deriveSignalFlags so the deploy-result rule can declare it alongside
  // green_to_red/red_to_green and the gate-skipped template branch renders.
  "gate_skipped",
]);

export const CronOnlyTrigger = z.object({
  cron_only: z.object({
    schedule: z.string().min(1),
  }),
});

export const TriggerItem = z.union([StringTriggerEnum, CronOnlyTrigger]);

export const FilterSchema = z
  .object({
    kind: z.string().optional(),
    slug: z.string().optional(),
    key: z.string().optional(),
    // R27 slot 5 B6: narrow `filter.dimension` to the closed DimensionEnum
    // to mirror `SignalSchema.dimension`. Pre-fix this was
    // `z.string().optional()`, so a typoed filter clause like
    // `dimension: "smokee"` passed validation and silently never matched any
    // probe key — the same silent-drop class of bug R26 closed for
    // `signal.dimension`. Rule side is closed; probe-key side stays open
    // (probe-key parsers fall back to `"unknown"`).
    dimension: DimensionEnum.optional(),
  })
  .strict();

export const SignalSchema = z
  .object({
    // R25 A1: closed enum — narrow `dimension` so a YAML typo like
    // `"smokee"` fails at load with a listed-valid-members error. The
    // comparison in `alert-engine.handleStatusChanged` previously silently
    // returned false forever when the rule's dimension didn't match any
    // probe's key-prefix.
    dimension: DimensionEnum,
    filter: FilterSchema.optional(),
  })
  .strict();

export const GuardSchema = z
  .object({
    minDeployAgeMin: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((g) => Object.keys(g).length > 0, {
    message: "guard must have at least one key",
  });

export const RateLimitSchema = z
  .object({
    perKey: z.string().optional(),
    window: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

export const SuppressSchema = z
  .object({
    when: z.string().min(1),
  })
  .strict();

export const EscalationSchema = z
  .object({
    whenFailCount: z.number().int().positive(),
    mention: z.string().optional(),
    severity: SeverityEnum.optional(),
  })
  .strict();

export const ConditionsSchema = z
  .object({
    guards: z.array(GuardSchema).optional(),
    // Null is accepted at the YAML layer as "disable the default rate_limit"
    // (e.g. weekly reports that should always fire). Downstream merge/use
    // coerces null to "disabled" by checking `rate_limit?.window` truthiness.
    rate_limit: z.union([RateLimitSchema, z.null()]).optional(),
    suppress: SuppressSchema.optional(),
    escalations: z.array(EscalationSchema).optional(),
  })
  .strict();

export const TargetSchema = z
  .object({
    kind: z.string().min(1),
    webhook: z.string().optional(),
  })
  .passthrough();

export const TemplateSchema = z
  .object({
    text: z.string().min(1),
    blocks: z.unknown().optional(),
  })
  .strict();

export const ActionSchema = z
  .object({
    kind: z.enum(["rebuild"]),
    target: z.string().min(1),
    forEach: z.string().optional(),
  })
  .strict();

export const OnErrorSchema = z
  .object({
    template: TemplateSchema,
  })
  .strict();

/**
 * Cross-service alert aggregation (plan Item 4). When declared, matching
 * signals for this rule are collected into buckets keyed on `groupBy` field
 * values, and a composite alert fires once either the `minMatches` threshold
 * is hit or `windowMs` elapses since the first match.
 *
 * `.strict()` so a typoed field (e.g. `windowMsec`) surfaces at load time
 * rather than silently arming a bucket with the default value of `undefined`.
 */
export const AggregationSchema = z
  .object({
    // A7: groupBy is optional / may be empty → single bucket per rule. Use
    // this when the rule's `when` clause already partitions traffic (e.g.
    // one rule per dimension) and there's no finer partition to apply.
    groupBy: z.array(z.string().min(1)).optional(),
    windowMs: z.number().int().positive(),
    minMatches: z.number().int().positive(),
    template: z.string().min(1),
    // B1: `targets` removed — the engine uses `rule.targets` for aggregation
    // dispatch; a separate aggregation-level override was never wired and
    // silently dropped. Rule authors declaring it got no feedback and no
    // effect; `.strict()` on RuleSchema now rejects the field at load.
  })
  .strict();

export const RuleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    owner: z.string().min(1),
    // No `extends` field: defaults from `_defaults.yml` are always merged into
    // each rule at load time, so an explicit extends directive was redundant
    // and actively misleading (it was never resolved or validated).
    severity: SeverityEnum.optional(),
    signal: SignalSchema,
    triggers: z.array(TriggerItem).min(1),
    conditions: ConditionsSchema.optional(),
    targets: z.array(TargetSchema).optional(),
    template: TemplateSchema.optional(),
    actions: z.array(ActionSchema).optional(),
    on_error: OnErrorSchema.optional(),
    aggregation: AggregationSchema.optional(),
  })
  .strict();

export const DefaultsSchema = z
  .object({
    defaults: z
      .object({
        targets: z.array(TargetSchema).optional(),
        severity: SeverityEnum.optional(),
        conditions: ConditionsSchema.optional(),
        // `renderer` was historically permitted by this schema but silently
        // dropped by rule-loader.loadDefaults — authors declaring it got no
        // feedback and no effect. There is exactly one renderer today
        // (Mustache-based slack-text renderer) and no wiring to swap it
        // per-rule. Removing the field from the schema so a stray
        // `renderer: slack` in _defaults.yml fails at load with a clear
        // "unknown key" message instead of being silently inert.
      })
      .strict(),
  })
  .strict();

export type RuleDoc = z.infer<typeof RuleSchema>;
export type DefaultsDoc = z.infer<typeof DefaultsSchema>;
