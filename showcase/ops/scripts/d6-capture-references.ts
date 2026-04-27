#!/usr/bin/env tsx
/**
 * D6 — reference-snapshot capture CLI.
 *
 * Captures `ParitySnapshot` JSON files for every `D5FeatureType` against
 * the LangGraph-Python (LGP) showcase — the canonical implementation the
 * D6 parity probe grades every other showcase against. Snapshots land
 * under `showcase/ops/fixtures/d6-reference/<featureType>.json`.
 *
 * When to run:
 *   - Weekly cadence (matches the D6 probe's Monday rotation),
 *   - After an LGP showcase redeploy,
 *   - After a D5 fixture update (`fixtures/d5/*.json`),
 *   - After a parity-tolerances change in `parity-compare.ts`,
 *   - After an ag-ui protocol bump.
 *
 * Usage:
 *   tsx scripts/d6-capture-references.ts
 *   tsx scripts/d6-capture-references.ts --integration langgraph-python
 *   tsx scripts/d6-capture-references.ts --base-url https://langgraph-python.up.railway.app
 *   tsx scripts/d6-capture-references.ts --feature agentic-chat
 *
 * Env overrides (`--flag` wins over env when both are set):
 *   LGP_BASE_URL          base URL of the LGP showcase (required if
 *                         `--base-url` not passed)
 *   D6_REFERENCE_DIR      override output directory (defaults to
 *                         `<package>/fixtures/d6-reference`)
 *
 * Exit codes:
 *   0   every result was `captured` or `skipped` (no failures)
 *   1   any result was `failed`, OR a required argument was missing,
 *       OR an unexpected error occurred during capture orchestration.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page as PlaywrightPage } from "playwright";
import { findPackageRoot } from "../src/probes/helpers/package-root.js";
import {
  captureAllReferences,
  captureReferenceForFeature,
  defaultWriteSnapshot,
  serializeRelevantDom,
  type ReferenceCaptureBrowserHandle,
  type ReferenceCaptureContext,
  type ReferenceCaptureDeps,
  type ReferenceCapturePage,
  type ReferenceCaptureResult,
} from "../src/probes/helpers/reference-capture.js";
import {
  attachSseInterceptor,
  type SseInterceptorHandle,
} from "../src/probes/helpers/sse-interceptor.js";
import {
  runConversation,
  type ConversationTurn,
  type Page as RunnerPage,
} from "../src/probes/helpers/conversation-runner.js";
import {
  D5_REGISTRY,
  isD5FeatureType,
  type D5FeatureType,
} from "../src/probes/helpers/d5-registry.js";
import { defaultScriptLoader } from "../src/probes/drivers/e2e-deep.js";
import type { ProbeContext } from "../src/types/index.js";

interface Args {
  integration: string;
  baseUrl: string;
  feature?: D5FeatureType;
  outputDir: string;
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    const next = argv[idx + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`flag --${name} requires a value`);
    }
    return next;
  };

  const integration = flag("integration") ?? "langgraph-python";
  const baseUrl = flag("base-url") ?? process.env.LGP_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "missing --base-url (or set LGP_BASE_URL env). Example: " +
        "--base-url https://langgraph-python.up.railway.app",
    );
  }
  const featureRaw = flag("feature");
  let feature: D5FeatureType | undefined;
  if (featureRaw !== undefined) {
    if (!isD5FeatureType(featureRaw)) {
      const known = [...D5_REGISTRY.keys()].sort().join(", ");
      throw new Error(
        `unknown --feature "${featureRaw}". Known: ${known || "(registry empty)"}`,
      );
    }
    if (!D5_REGISTRY.has(featureRaw)) {
      const known = [...D5_REGISTRY.keys()].sort().join(", ");
      throw new Error(
        `unknown --feature "${featureRaw}". Known: ${known || "(registry empty)"}`,
      );
    }
    feature = featureRaw;
  }
  const outputDir =
    process.env.D6_REFERENCE_DIR ??
    path.resolve(resolvePackageRoot(), "fixtures", "d6-reference");

  return { integration, baseUrl, feature, outputDir };
}

/**
 * Resolve the showcase-ops package root via `findPackageRoot`. Handles
 * both source and compiled locations:
 *
 *   - source:    `<package>/scripts/d6-capture-references.ts`  → `<package>`
 *   - compiled:  `<package>/dist/scripts/d6-capture-references.js` → `<package>`
 *
 * Without this, `path.dirname(import.meta.url) + ".."` resolves to
 * `<package>` from source but `<package>/dist` after build, so the
 * default `outputDir` becomes `<package>/dist/fixtures/d6-reference`
 * — wrong destination. The shared helper is source/dist-symmetric.
 */
function resolvePackageRoot(): string {
  return findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
}

/**
 * Build the production dependency surface. Mirrors the wiring the D6
 * driver uses — same launcher args, same interceptor, same DOM
 * serializer, same disk writer. Kept inline (not factored) because the
 * driver and the CLI have slightly different page-shape needs (the
 * driver carries a `asPlaywrightPage()` shim; the CLI hands the raw
 * Playwright page straight through), and a shared helper would need
 * conditional branches that obscure each call site.
 */
async function buildDeps(): Promise<ReferenceCaptureDeps> {
  const mod = (await import("playwright")) as typeof import("playwright");

  return {
    launchBrowser: async (): Promise<ReferenceCaptureBrowserHandle> => {
      const browser = await mod.chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // Playwright's Page satisfies ReferenceCapturePage structurally;
      // cast through unknown because the structural compat isn't visible
      // through Playwright's overloads.
      const wrapped = page as unknown as ReferenceCapturePage;
      return {
        page: wrapped,
        close: async () => {
          await ctx.close();
          await browser.close();
        },
      };
    },
    attachSseInterceptor: (page) =>
      attachSseInterceptor(page as unknown as PlaywrightPage),
    runConversation: (page: ReferenceCapturePage, turns: ConversationTurn[]) =>
      runConversation(page as RunnerPage, turns),
    serializeDom: (page) => serializeRelevantDom(page),
    writeSnapshot: defaultWriteSnapshot,
    warn: (message, extra) => {
      const line = `[d6-capture] WARN ${message}`;
      if (extra) {
        // eslint-disable-next-line no-console
        console.warn(line, extra);
      } else {
        // eslint-disable-next-line no-console
        console.warn(line);
      }
    },
  };
}

function summaryLine(r: ReferenceCaptureResult): string {
  const tail =
    r.status === "captured"
      ? (r.snapshotPath ?? "(no snapshotPath)")
      : (r.reason ?? "(no reason)");
  return `[d6-capture] ${r.featureType} → ${r.status} (${tail})`;
}

/**
 * Build a minimal `ProbeContext` for the script loader. The CLI does
 * not have an invoker-level logger / writer / abort signal — it just
 * needs `logger` for the loader's warn/error reporting.
 */
function buildLoaderCtx(): ProbeContext {
  return {
    now: () => new Date(),
    env: process.env,
    logger: {
      // eslint-disable-next-line no-console
      info: (msg, extra) => console.log(`[d6-capture] ${msg}`, extra ?? ""),
      // eslint-disable-next-line no-console
      warn: (msg, extra) =>
        console.warn(`[d6-capture] WARN ${msg}`, extra ?? ""),
      // eslint-disable-next-line no-console
      error: (msg, extra) =>
        console.error(`[d6-capture] ERROR ${msg}`, extra ?? ""),
      // eslint-disable-next-line no-console
      debug: (msg, extra) =>
        console.log(`[d6-capture] DEBUG ${msg}`, extra ?? ""),
    },
  };
}

async function main(): Promise<number> {
  // Populate the D5 registry by scanning `src/probes/scripts/` and
  // importing each `d5-*.ts` file (each one calls `registerD5Script(...)`
  // as a top-level side effect). Without this, `D5_REGISTRY` would be
  // empty when `parseArgs` validates `--feature` and when
  // `captureAllReferences` enumerates known features — silently producing
  // a "no features captured" run that looks like success.
  try {
    await defaultScriptLoader(buildLoaderCtx());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[d6-capture] script loader failed: ${(err as Error).message}`,
    );
    return 1;
  }
  if (D5_REGISTRY.size === 0) {
    // eslint-disable-next-line no-console
    console.error(
      "[d6-capture] D5_REGISTRY is empty after script loader ran — " +
        "check that `src/probes/scripts/d5-*.ts` exist and call " +
        "`registerD5Script(...)` at module top-level.",
    );
    return 1;
  }

  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[d6-capture] ${(err as Error).message}`);
    return 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[d6-capture] integration=${args.integration} baseUrl=${args.baseUrl} ` +
      `feature=${args.feature ?? "ALL"} outputDir=${args.outputDir}`,
  );

  const ctx: ReferenceCaptureContext = {
    baseUrl: args.baseUrl,
    integrationSlug: args.integration,
    outputDir: args.outputDir,
  };

  const deps = await buildDeps();

  let results: ReferenceCaptureResult[];
  if (args.feature) {
    results = [await captureReferenceForFeature(args.feature, ctx, deps)];
  } else {
    results = await captureAllReferences(ctx, deps);
  }

  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(summaryLine(r));
  }

  const failed = results.filter((r) => r.status === "failed");
  const captured = results.filter((r) => r.status === "captured").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  // eslint-disable-next-line no-console
  console.log(
    `[d6-capture] done: captured=${captured} skipped=${skipped} ` +
      `failed=${failed.length}`,
  );
  return failed.length === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[d6-capture] orchestration error:", err);
    process.exit(1);
  });
