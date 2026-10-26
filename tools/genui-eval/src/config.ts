import { z } from "zod";

/** How the model sends A2UI: fences in its reply, or the render_ui tool. */
export type Transport = "markdown" | "tool";
export const TRANSPORTS: readonly Transport[] = ["markdown", "tool"];

const modelEntry = z.object({
  /** The short name used in presets and reports, e.g. "claude". */
  id: z.string().min(1),
  /**
   * The OpenRouter model, e.g. "anthropic/claude-sonnet-4.5", or
   * "fake:<script>" for the offline fake (no key, replies from
   * `fixtures/<script>/`).
   */
  model: z.string().min(1),
  /** The OpenRouter host to pin, e.g. "cerebras". Open models only. */
  provider: z.string().optional(),
  params: z
    .object({
      temperature: z.number().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
});

const preset = z.object({
  /** Model ids, or "all". */
  models: z.union([z.array(z.string()).min(1), z.literal("all")]),
  /** "all", or "tag:<tag>" for the cases with that tag. */
  cases: z.union([z.literal("all"), z.string().regex(/^tag:.+$/)]),
  /** Samples per case, model and transport. */
  samples: z.number().int().positive(),
  /** The transports of this preset. Defaults to the config's. */
  transports: z
    .array(z.enum(["markdown", "tool"]))
    .min(1)
    .optional(),
  /** The judge of this preset, instead of the config's (the offline preset uses a fake). */
  judge: z.string().optional(),
  /** The reflection model of this preset, instead of the config's. */
  reflection: z.string().optional(),
});

/** USD per million tokens, for the cost estimate. */
const price = z.object({ input: z.number(), output: z.number() });

const evalConfig = z
  .object({
    models: z.array(modelEntry).min(1),
    presets: z.record(preset),
    transports: z.array(z.enum(["markdown", "tool"])).min(1),
    /** The default budget of a run, in USD. */
    budgetUsd: z.number().nonnegative(),
    /** The fixed judge. Never a model under test in the same run. */
    judge: z.object({ model: z.string().min(1) }),
    /** The fixed reflection model of the optimizer. Never the judge. */
    reflection: z.object({ model: z.string().min(1) }),
    /** Prices by model, for the estimate. Unknown models use `defaultPrice`. */
    prices: z.record(price).default({}),
    defaultPrice: price.default({ input: 3, output: 15 }),
    /** Parallel samples. */
    concurrency: z.number().int().positive().default(4),
  })
  .superRefine((config, ctx) => {
    const ids = new Set(config.models.map((m) => m.id));
    if (ids.size !== config.models.length) {
      ctx.addIssue({ code: "custom", message: "model ids must be unique" });
    }
    for (const [name, p] of Object.entries(config.presets)) {
      if (p.models === "all") continue;
      for (const id of p.models) {
        if (!ids.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["presets", name, "models"],
            message: `preset "${name}" names unknown model "${id}"`,
          });
        }
      }
    }
    if (config.judge.model === config.reflection.model) {
      ctx.addIssue({
        code: "custom",
        path: ["reflection", "model"],
        message: "the reflection model must differ from the judge",
      });
    }
    for (const [name, p] of Object.entries(config.presets)) {
      const judge = p.judge ?? config.judge.model;
      const reflection = p.reflection ?? config.reflection.model;
      if (judge === reflection) {
        ctx.addIssue({
          code: "custom",
          path: ["presets", name],
          message: `preset "${name}": the reflection model must differ from the judge`,
        });
      }
    }
  });

export type ModelEntry = z.infer<typeof modelEntry>;
export type Preset = z.infer<typeof preset>;
export type EvalConfigInput = z.input<typeof evalConfig>;
export type EvalConfig = z.output<typeof evalConfig>;

/** Checks the config and fills the defaults. Throws with every problem. */
export function defineEvalConfig(config: EvalConfigInput): EvalConfig {
  const parsed = evalConfig.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `Invalid eval config:\n${parsed.error.issues.map((i) => `- ${i.message}`).join("\n")}`,
    );
  }
  return parsed.data;
}

/** What a run uses, after the preset and the command-line overrides. */
export interface ResolvedPlan {
  preset: string;
  models: ModelEntry[];
  cases: Preset["cases"];
  samples: number;
  transports: Transport[];
  /** The judge model. Never one of `models`. */
  judge: string;
  /** The reflection model of the optimizer. */
  reflection: string;
}

/**
 * The models, cases, samples and transports of `presetName`, with the
 * command-line overrides applied.
 */
export function resolvePlan(
  config: EvalConfig,
  presetName: string,
  overrides: {
    models?: string[];
    cases?: Preset["cases"];
    samples?: number;
    transports?: Transport[];
  } = {},
): ResolvedPlan {
  const p = config.presets[presetName];
  if (!p) {
    throw new Error(
      `Unknown preset "${presetName}". Presets: ${Object.keys(config.presets).join(", ")}`,
    );
  }
  const ids = overrides.models ?? (p.models === "all" ? undefined : p.models);
  const models = ids
    ? ids.map((id) => {
        const entry = config.models.find((m) => m.id === id);
        if (!entry) throw new Error(`Unknown model "${id}"`);
        return entry;
      })
    : config.models;
  const judge = p.judge ?? config.judge.model;
  if (models.some((m) => m.model === judge)) {
    throw new Error(
      `The judge "${judge}" is also a model under test; pick another judge or model set.`,
    );
  }
  return {
    preset: presetName,
    models,
    cases: overrides.cases ?? p.cases,
    samples: overrides.samples ?? p.samples,
    transports: overrides.transports ?? p.transports ?? config.transports,
    judge,
    reflection: p.reflection ?? config.reflection.model,
  };
}
