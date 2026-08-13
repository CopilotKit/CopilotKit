import { expect, test } from "vitest";
import {
  measureConsumerBundles,
  measureFeatureBundles,
} from "../benchmarks/bundle-size.js";
import type { BundleSize } from "../benchmarks/bundle-size.js";

const compactBudgets = {
  object: { brotli: 2_100, gzip: 2_350, minified: 6_500 },
  scalar: { brotli: 1_650, gzip: 1_850, minified: 4_700 },
  union: { brotli: 2_050, gzip: 2_300, minified: 6_200 },
} as const satisfies Readonly<Record<string, BundleSize>>;

test("a representative consumer bundle stays smaller than the larger comparisons", async () => {
  const { arktype, schema, valibot, zodMini } = await measureConsumerBundles();

  for (const [library, comparison] of Object.entries({
    arktype,
    zodMini,
  })) {
    const evidence = JSON.stringify({ comparison, library, schema });

    expect(schema.minified, evidence).toBeLessThan(comparison.minified);
    expect(schema.gzip, evidence).toBeLessThan(comparison.gzip);
    expect(schema.brotli, evidence).toBeLessThan(comparison.brotli);
  }
});

test("scalar and union consumer bundles stay smaller than the larger comparisons", async () => {
  const scenarios = await measureFeatureBundles();

  for (const [name, { arktype, schema, valibot, zodMini }] of Object.entries(
    scenarios,
  )) {
    for (const [library, comparison] of Object.entries({
      arktype,
      zodMini,
    })) {
      const evidence = JSON.stringify({
        comparison,
        library,
        name,
        schema,
      });

      expect(schema.minified, evidence).toBeLessThan(comparison.minified);
      expect(schema.gzip, evidence).toBeLessThan(comparison.gzip);
      expect(schema.brotli, evidence).toBeLessThan(comparison.brotli);
    }
  }
});

test("consumer bundles never exceed the compact schema budgets", async () => {
  const object = (await measureConsumerBundles()).schema;
  const features = await measureFeatureBundles();
  const measurements = {
    object,
    scalar: features.scalar!.schema,
    union: features.union!.schema,
  };

  for (const [name, budget] of Object.entries(compactBudgets)) {
    const measurement = measurements[name as keyof typeof measurements];
    const evidence = JSON.stringify({ budget, measurement, name });

    expect(measurement.minified, evidence).toBeLessThanOrEqual(budget.minified);
    expect(measurement.gzip, evidence).toBeLessThanOrEqual(budget.gzip);
    expect(measurement.brotli, evidence).toBeLessThanOrEqual(budget.brotli);
  }
});
