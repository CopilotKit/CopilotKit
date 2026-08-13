import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { build } from "esbuild";

export interface BundleSize {
  readonly brotli: number;
  readonly gzip: number;
  readonly minified: number;
}

export interface ConsumerBundleSizes {
  readonly arktype: BundleSize;
  readonly schema: BundleSize;
  readonly valibot: BundleSize;
  readonly zodMini: BundleSize;
}

export type FeatureBundleSizes = Readonly<Record<string, ConsumerBundleSizes>>;

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * Bundle one consumer entry and report its minified and compressed byte sizes.
 */
async function measureBundle(contents: string): Promise<BundleSize> {
  const result = await build({
    bundle: true,
    format: "esm",
    minify: true,
    platform: "browser",
    stdin: {
      contents,
      loader: "ts",
      resolveDir: packageRoot,
      sourcefile: "consumer.ts",
    },
    target: "es2022",
    treeShaking: true,
    write: false,
  });
  const output = result.outputFiles[0]?.contents;
  if (!output) {
    throw new Error("esbuild did not produce a consumer bundle");
  }
  return {
    brotli: brotliCompressSync(output).byteLength,
    gzip: gzipSync(output).byteLength,
    minified: output.byteLength,
  };
}

/**
 * Measure equivalent object-and-array consumer bundles for each library.
 */
export async function measureConsumerBundles(): Promise<ConsumerBundleSizes> {
  const [schema, arktype, valibot, zodMini] = await Promise.all([
    measureBundle(`
      import { array, boolean, number, object, safeParse, string } from "./dist/index.mjs";
      const schema = object({
        active: boolean(),
        age: number(),
        name: string(),
        tags: array(string()),
      });
      globalThis.result = safeParse(schema, globalThis.input);
    `),
    measureBundle(`
      import { type } from "arktype";
      const schema = type({
        active: "boolean",
        age: "number",
        name: "string",
        tags: "string[]",
      }).onUndeclaredKey("delete");
      globalThis.result = schema(globalThis.input);
    `),
    measureBundle(`
      import { array, boolean, number, object, safeParse, string } from "valibot";
      const schema = object({
        active: boolean(),
        age: number(),
        name: string(),
        tags: array(string()),
      });
      globalThis.result = safeParse(schema, globalThis.input);
    `),
    measureBundle(`
      import * as z from "zod/v4-mini";
      const schema = z.object({
        active: z.boolean(),
        age: z.number(),
        name: z.string(),
        tags: z.array(z.string()),
      });
      globalThis.result = z.safeParse(schema, globalThis.input);
    `),
  ]);
  return { arktype, schema, valibot, zodMini };
}

/**
 * Measure small scalar and composition consumers to catch hidden entry costs.
 */
export async function measureFeatureBundles(): Promise<FeatureBundleSizes> {
  const [scalarSchema, scalarArktype, scalarValibot, scalarZodMini] =
    await Promise.all([
      measureBundle(`
      import { safeParse, string } from "./dist/index.mjs";
      globalThis.result = safeParse(string(), globalThis.input);
    `),
      measureBundle(`
      import { type } from "arktype";
      globalThis.result = type("string")(globalThis.input);
    `),
      measureBundle(`
      import { safeParse, string } from "valibot";
      globalThis.result = safeParse(string(), globalThis.input);
    `),
      measureBundle(`
      import * as z from "zod/v4-mini";
      globalThis.result = z.safeParse(z.string(), globalThis.input);
    `),
    ]);
  const [unionSchema, unionArktype, unionValibot, unionZodMini] =
    await Promise.all([
      measureBundle(`
      import { literal, number, safeParse, union } from "./dist/index.mjs";
      const schema = union([literal("ready"), number()]);
      globalThis.result = safeParse(schema, globalThis.input);
    `),
      measureBundle(`
      import { type } from "arktype";
      globalThis.result = type("'ready' | number")(globalThis.input);
    `),
      measureBundle(`
      import { literal, number, safeParse, union } from "valibot";
      const schema = union([literal("ready"), number()]);
      globalThis.result = safeParse(schema, globalThis.input);
    `),
      measureBundle(`
      import * as z from "zod/v4-mini";
      const schema = z.union([z.literal("ready"), z.number()]);
      globalThis.result = z.safeParse(schema, globalThis.input);
    `),
    ]);
  return {
    scalar: {
      arktype: scalarArktype,
      schema: scalarSchema,
      valibot: scalarValibot,
      zodMini: scalarZodMini,
    },
    union: {
      arktype: unionArktype,
      schema: unionSchema,
      valibot: unionValibot,
      zodMini: unionZodMini,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sizes = await measureConsumerBundles();
  console.table(sizes);
  const features = await measureFeatureBundles();
  for (const [name, featureSizes] of Object.entries(features)) {
    console.log(name);
    console.table(featureSizes);
  }
}
