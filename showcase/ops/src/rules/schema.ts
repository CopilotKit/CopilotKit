import { z } from "zod";

export const SeverityEnum = z.enum(["info", "warn", "error", "critical"]);

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
    dimension: z.string().optional(),
  })
  .strict();

export const SignalSchema = z
  .object({
    dimension: z.string().min(1),
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
