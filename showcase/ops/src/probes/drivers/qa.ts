import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { showcaseShapeSchema } from "../discovery/railway-services.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * Phase 4A.1 — QA probe driver.
 *
 * Reads `showcase/integrations/<slug>/manifest.yaml` to get the list of demos,
 * then checks `showcase/integrations/<slug>/qa/<featureId>.md` for each demo.
 * Emits one side-row per feature (`qa:<slug>/<featureId>`, green when the
 * file exists, red when missing) plus an aggregate primary result
 * (`qa:<slug>`, green iff every demo has a matching QA file).
 *
 * Dashboard wiring: `shell-dashboard/src/lib/live-status.ts#resolveCell`
 * reads each per-cell row via `keyFor("qa", slug, featureId)` which
 * formats as `qa:<slug>/<featureId>`. QA is informational only — it does
 * NOT feed the rollup — but it still needs its own closed-enum dimension
 * slot so rule YAMLs keyed on `qa` validate at load time (see `DIMENSIONS`
 * in `../../types/index.ts`).
 *
 * Starter shape: starters are single-app integrations with no `/demos/*`
 * routing, so the driver short-circuits before hitting the manifest —
 * returns a green aggregate and emits zero side rows. Matches the
 * e2e-smoke driver's starter short-circuit, avoids false-red QA rows
 * under the starter key.
 *
 * Repo-root resolution:
 *   1. `deps.repoRoot` (constructor injection, preferred for tests).
 *   2. `ctx.env.QA_REPO_ROOT` (operator override for ad-hoc checkouts).
 *   3. Walk up from the driver file to the monorepo root.
 */

const qaInputSchema = z
  .object({
    key: z.string().min(1),
    // Railway service name, e.g. "showcase-mastra". Optional — used as a
    // fallback when `slug` isn't supplied explicitly. Matches smoke/e2e-smoke
    // discovery-mode input shape.
    name: z.string().optional(),
    /** Explicit slug. Wins over `name` when both are present. */
    slug: z.string().optional(),
    /**
     * Optional deployment shape. When `shape === "starter"` the driver
     * short-circuits: no manifest read, no side rows, green aggregate.
     * Package shape (or absent) proceeds with the QA file-presence check.
     */
    shape: showcaseShapeSchema.optional(),
  })
  .passthrough();

type QaDriverInput = z.infer<typeof qaInputSchema>;

/**
 * Aggregate signal carried on the primary `qa:<slug>` ProbeResult.
 * `features` is the full list read off the manifest so templates can
 * render the specific missing features without re-reading the filesystem.
 */
export interface QaAggregateSignal {
  slug: string;
  total: number;
  covered: number;
  missing: string[];
  shape?: "package" | "starter";
  note?: string;
}

/** Per-feature signal carried on each `qa:<slug>/<featureId>` side row. */
export interface QaFeatureSignal {
  slug: string;
  featureId: string;
  qaPath: string;
  exists: boolean;
}

export type QaDriverSignal = QaAggregateSignal | { errorDesc: string };

export interface QaDriverDeps {
  /** Explicit monorepo root. Overrides `ctx.env.QA_REPO_ROOT` and the default walk-up. */
  repoRoot?: string;
}

/**
 * Minimum shape the driver reads out of a package manifest. `demos[]`
 * carries `{ id }` objects (plus other fields the driver ignores). An
 * integration without a `demos:` block is structurally valid — some
 * integrations are starter-only or still in draft — and the driver
 * treats that as "nothing to check, aggregate green".
 */
interface ManifestShape {
  demos?: Array<{ id?: unknown }>;
}

export function createQaDriver(
  deps: QaDriverDeps = {},
): ProbeDriver<QaDriverInput, QaDriverSignal> {
  return {
    kind: "qa",
    inputSchema: qaInputSchema,
    async run(ctx, input) {
      const observedAt = ctx.now().toISOString();
      const slug = deriveSlug(input);
      const repoRoot = deps.repoRoot ?? resolveRepoRoot(ctx);

      // Starter short-circuit: no /demos/* routing means no per-feature
      // QA coverage to check. Green aggregate, no side rows.
      if (input.shape === "starter") {
        return {
          key: input.key,
          state: "green",
          signal: {
            slug,
            total: 0,
            covered: 0,
            missing: [],
            shape: "starter",
            note: "starter: no /demos/* routing",
          },
          observedAt,
        };
      }

      const pkgDir = path.join(repoRoot, "showcase", "packages", slug);
      const manifestPath = path.join(pkgDir, "manifest.yaml");

      let manifestRaw: string;
      try {
        manifestRaw = fs.readFileSync(manifestPath, "utf8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("probe.qa.manifest-read-failed", {
          manifestPath,
          err: msg,
        });
        return {
          key: input.key,
          state: "error",
          signal: {
            errorDesc: `failed to read manifest.yaml at ${manifestPath}: ${msg}`,
          },
          observedAt,
        };
      }

      let manifest: ManifestShape;
      try {
        manifest = (yaml.load(manifestRaw) as ManifestShape) ?? {};
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.logger.warn("probe.qa.manifest-parse-failed", {
          manifestPath,
          err: msg,
        });
        return {
          key: input.key,
          state: "error",
          signal: {
            errorDesc: `failed to parse manifest.yaml at ${manifestPath}: ${msg}`,
          },
          observedAt,
        };
      }

      const demoIds: string[] = Array.isArray(manifest.demos)
        ? manifest.demos
            .map((d) => (typeof d?.id === "string" ? d.id : null))
            .filter((id): id is string => id !== null && id.length > 0)
        : [];

      // Empty demos set: nothing to check. Aggregate green, no side rows.
      // A starter-only integration (no `demos:` block) lands here, as does
      // a brand-new package still being scaffolded.
      if (demoIds.length === 0) {
        return {
          key: input.key,
          state: "green",
          signal: {
            slug,
            total: 0,
            covered: 0,
            missing: [],
            shape: "package",
            note: "no demos declared in manifest",
          },
          observedAt,
        };
      }

      const qaDir = path.join(pkgDir, "qa");
      const missing: string[] = [];

      for (const featureId of demoIds) {
        const qaPath = path.join(qaDir, `${featureId}.md`);
        const exists = fs.existsSync(qaPath);
        if (!exists) missing.push(featureId);
        const sideKey = `qa:${slug}/${featureId}`;
        const sideSignal: QaFeatureSignal = {
          slug,
          featureId,
          qaPath,
          exists,
        };
        await sideEmit(ctx, {
          key: sideKey,
          state: exists ? "green" : "red",
          signal: sideSignal,
          observedAt: ctx.now().toISOString(),
        });
      }

      const aggregateState = missing.length === 0 ? "green" : "red";
      return {
        key: input.key,
        state: aggregateState,
        signal: {
          slug,
          total: demoIds.length,
          covered: demoIds.length - missing.length,
          missing,
          shape: "package",
        },
        observedAt,
      };
    },
  };
}

/** Default driver instance — repo root resolved lazily per-call from env / default walk-up. */
export const qaDriver = createQaDriver();

/**
 * Derive the slug from driver input. Priority:
 *   1. explicit `slug` field,
 *   2. `name` with the `showcase-` prefix stripped,
 *   3. key suffix after the first `:`,
 *   4. whole key as fallback.
 * Matches the smoke/e2e-smoke slug-derivation semantics so operators get
 * one consistent mental model across drivers.
 */
function deriveSlug(input: QaDriverInput): string {
  if (typeof input.slug === "string" && input.slug.length > 0) {
    return input.slug;
  }
  if (typeof input.name === "string" && input.name.length > 0) {
    const stripped = input.name.replace(/^showcase-/, "");
    if (stripped.length > 0) return stripped;
  }
  const parts = input.key.split(":");
  if (parts.length >= 2 && parts[1]!.length > 0) return parts[1]!;
  return input.key;
}

/**
 * Emit a per-feature ProbeResult through `ctx.writer`. Absent writer is
 * logged-and-skipped (matches the smoke driver's side-emit pattern);
 * writer throws are non-fatal so a side-emit hiccup can't take the
 * aggregate tick down with it.
 */
async function sideEmit(
  ctx: ProbeContext,
  result: ProbeResult<QaFeatureSignal>,
): Promise<void> {
  if (!ctx.writer) {
    ctx.logger.warn("probe.qa.writer-missing", { key: result.key });
    return;
  }
  try {
    await ctx.writer.write(result);
  } catch (err) {
    ctx.logger.error("probe.qa.side-emit-writer-failed", {
      key: result.key,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Resolve the monorepo root. `ctx.env.QA_REPO_ROOT` takes precedence so
 * operators can point the driver at a specific checkout without a rebuild;
 * the fallback walks up from the driver file's location:
 * `showcase/ops/src/probes/drivers/qa.ts` → repo root via 5-segment up-walk.
 * Matches the pin-drift driver's resolution strategy.
 */
function resolveRepoRoot(ctx: ProbeContext): string {
  const fromEnv = ctx.env.QA_REPO_ROOT;
  if (fromEnv && fromEnv.trim() !== "") return fromEnv;
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "..",
    "..",
    "..",
  );
}
