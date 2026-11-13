import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { PbClient } from "../storage/pb-client.js";
import type { Logger } from "../types/index.js";
import { COMPATIBILITY_MAPPING } from "../shared/compatibility-mapping.js";
import { verifyHmac } from "./hmac.js";

const PATH = "/api/compatibility";
const COLLECTION = "compatibility";
const same = (left: string[], right: string[]) =>
  JSON.stringify(left) === JSON.stringify(right);
const score = z.number().int().min(0).max(100).nullable();
const httpUrl = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//.test(url));
const snapshotSchema = z.object({
  date: z.string().min(1),
  assessedAt: z.string().datetime(),
  methodology: httpUrl,
  rows: z
    .array(
      z.object({
        slug: z.string().min(1),
        language: z.string().min(1),
        currentScore: score,
        status: z.enum([
          "build_verified_fallback_scored",
          "source_declared_prototype_scored",
          "policy_pending_or_incomplete_package_score",
          "not_verified",
          "stale_historical_only_not_current",
          "internal_non_comparable",
        ]),
        packages: z.array(
          z.object({
            name: z.string().min(1),
            role: z.string().min(1),
            drivesCompatibility: z.boolean(),
            compatibilityScore: score,
            setsVariantScore: z.boolean(),
            runningVersion: z.string().nullable(),
            latest: z.string().nullable(),
            sourceUrl: httpUrl.nullable(),
          }),
        ),
      }),
    )
    .min(1),
});
const common = {
  environmentId: z.string().min(1),
  attemptedAt: z.string().datetime(),
  runUrl: httpUrl,
};
const publicationSchema = z.discriminatedUnion("status", [
  z.object({
    ...common,
    status: z.literal("success"),
    snapshot: snapshotSchema,
    sourceCommits: z.record(z.string().regex(/^[a-f0-9]{40}$/)),
  }),
  z.object({
    ...common,
    status: z.literal("failed"),
    error: z.string().min(1).max(500),
  }),
]);
interface SavedRecord {
  snapshot?: z.infer<typeof snapshotSchema> | null;
  last_attempt_at?: string;
  last_attempt_status?: "success" | "failed";
  error?: string;
  run_url?: string;
}
export interface CompatibilityRouteDeps {
  pb: PbClient;
  logger: Logger;
  secrets: string[];
  environmentId?: string;
  nowSec?: () => number;
  expectedLibraries?: Record<string, string[]>;
}

/** One environment-local saved assessment; only signed automation can write. */
export function registerCompatibilityRoutes(
  app: Hono,
  deps: CompatibilityRouteDeps,
): void {
  const expectedLibraries =
    deps.expectedLibraries ??
    Object.fromEntries(
      COMPATIBILITY_MAPPING.filter(
        (variant) => variant.excludedReason === undefined,
      ).map((variant) => [
        variant.slug,
        variant.libraries
          .filter((library) => library.required)
          .map((library) => library.name),
      ]),
    );
  let pendingWrite = Promise.resolve();
  app.get(PATH, async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const record = await deps.pb.getFirst<SavedRecord>(
        COLLECTION,
        'key = "current"',
      );
      return c.json({
        environmentId: deps.environmentId ?? null,
        snapshot: record?.snapshot ?? null,
        lastAttemptAt: record?.last_attempt_at ?? null,
        lastAttemptStatus: record?.last_attempt_status ?? null,
        error: record?.error ?? null,
        runUrl: record?.run_url ?? null,
      });
    } catch (error) {
      deps.logger.error("compatibility.read.failed", {
        error:
          error instanceof Error ? error.message : "Unknown storage failure",
      });
      return c.json({ error: "Saved compatibility results unavailable" }, 503);
    }
  });
  app.post(PATH, bodyLimit({ maxSize: 1_000_000 }), async (c) => {
    const body = await c.req.text();
    const auth = verifyHmac({
      method: "POST",
      path: PATH,
      body,
      timestamp: c.req.header("X-Ops-Timestamp") ?? "",
      signatureHeader: c.req.header("X-Ops-Signature") ?? "",
      secrets: deps.secrets,
      nowSec: deps.nowSec,
    });
    if (!auth.ok) return c.json({ error: "unauthorized" }, 401);
    if (!deps.environmentId)
      return c.json({ error: "Environment ID is not configured" }, 503);
    let input: z.infer<typeof publicationSchema>;
    try {
      input = publicationSchema.parse(JSON.parse(body));
    } catch {
      return c.json({ error: "Invalid compatibility publication" }, 400);
    }
    if (input.environmentId !== deps.environmentId)
      return c.json(
        { error: "Compatibility result belongs to another environment" },
        400,
      );
    if (
      input.status === "success" &&
      input.snapshot.assessedAt !== input.attemptedAt
    )
      return c.json(
        { error: "Assessment timestamp differs from the audit timestamp" },
        400,
      );
    if (input.status === "success") {
      const expectedSlugs = Object.keys(expectedLibraries).sort();
      const actualSlugs = input.snapshot.rows.map((row) => row.slug).sort();
      const sourceSlugs = Object.keys(input.sourceCommits).sort();
      if (
        !same(expectedSlugs, actualSlugs) ||
        !same(expectedSlugs, sourceSlugs) ||
        input.snapshot.rows.some(
          (row) =>
            !same(
              [...expectedLibraries[row.slug]].sort(),
              row.packages.map((pkg) => pkg.name).sort(),
            ) ||
            row.packages.some(
              (pkg) => !pkg.drivesCompatibility || pkg.role !== "framework",
            ),
        )
      )
        return c.json(
          {
            error:
              "Compatibility publication does not contain the complete library roster",
          },
          400,
        );
    }
    // One environment-local assessment: serialize its compare-and-save operation,
    // including manual callers and retries outside the Actions concurrency gate.
    const precedingWrite = pendingWrite;
    let release!: () => void;
    pendingWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    await precedingWrite;
    try {
      const previous = await deps.pb.getFirst<SavedRecord>(
        COLLECTION,
        'key = "current"',
      );
      if (
        previous?.last_attempt_at &&
        Date.parse(previous.last_attempt_at) > Date.parse(input.attemptedAt)
      )
        return c.json(
          { error: "A newer compatibility audit has already been saved" },
          409,
        );
      const update = {
        last_attempt_at: input.attemptedAt,
        last_attempt_status: input.status,
        run_url: input.runUrl,
        error: input.status === "failed" ? input.error : "",
        ...(input.status === "success"
          ? {
              snapshot: input.snapshot,
              source_commits: input.sourceCommits,
            }
          : {}),
      };
      await deps.pb.upsertByField(COLLECTION, "key", "current", update);
      deps.logger.info("compatibility.published", {
        status: input.status,
        attemptedAt: input.attemptedAt,
      });
      return c.json({ ok: true });
    } catch (error) {
      deps.logger.error("compatibility.publication.failed", {
        error:
          error instanceof Error ? error.message : "Unknown storage failure",
      });
      return c.json({ error: "Compatibility publication failed" }, 503);
    } finally {
      release();
    }
  });
}
