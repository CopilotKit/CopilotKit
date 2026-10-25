import { z } from "zod";

/** Wire contracts for the project-key Learning API; keep aligned with Intelligence. */
export const learningContainerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const learningContainerSchema = z.object({
  id: learningContainerIdSchema,
  name: z.string().min(1),
  projectId: z.number().int().positive(),
  promptContext: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export const learningContainerPageSchema = z.object({
  containers: z.array(learningContainerSchema).max(500),
  nextCursor: z.string().min(1).nullable(),
});
export type LearningContainer = z.infer<typeof learningContainerSchema>;
export type LearningContainerPage = z.infer<typeof learningContainerPageSchema>;
export interface LearningRequestOptions {
  readonly signal?: AbortSignal;
}
export interface LearningContainerRequest extends LearningRequestOptions {
  readonly containerId: string;
}

/** Validates a stable identifier before constructing a request path. */
export function learningContainerPath(containerId: string): string {
  return `/api/v1/learning/containers/${encodeURIComponent(learningContainerIdSchema.parse(containerId))}`;
}

/** Reads a bounded JSON response while the request's signal governs stream cancellation. */
export async function readLearningJson(
  response: Response,
  limit = 16 * 1024 * 1024,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!response.body) throw new Error("Missing Learning response body");
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("Learning response exceeds its size limit");
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

const learningSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const learningUuidSchema = z.string().uuid();
const learningDateTimeSchema = z.string().datetime({ offset: true });

/** One immutable file in a proposed Skill candidate bundle. */
export const learningSkillBundleFileSchema = z.object({
  content: z.string(),
  path: z
    .string()
    .min(1)
    .refine(
      (path) =>
        !path.startsWith("/") &&
        !path.split("/").some((segment) => segment === ".."),
      "Bundle paths must be relative and may not traverse parent directories.",
    ),
  sha256: learningSha256Schema,
});

/** Complete Skill files attached to one review candidate. */
export const learningSkillBundleSchema = z
  .object({
    files: z.array(learningSkillBundleFileSchema).min(1),
    schemaVersion: z.literal(1),
  })

  .superRefine(({ files }, context) => {
    const paths = new Set<string>();
    for (const file of files) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate bundle path: ${file.path}`,
          path: ["files"],
        });
      }
      paths.add(file.path);
    }
    if (!paths.has("SKILL.md")) {
      context.addIssue({
        code: "custom",
        message: "A Skill bundle must contain SKILL.md.",
        path: ["files"],
      });
    }
  });

/** Review state and summary returned for one proposed Skill change. */
export const learningCandidateSchema = z.object({
  bundleSha256: learningSha256Schema,
  createdAt: learningDateTimeSchema,
  description: z.string().min(1),
  id: learningUuidSchema,
  operation: z.enum(["add", "update", "remove"]),
  publishedRegistryRevision: z.number().int().positive().nullable(),
  publishedSkillId: learningUuidSchema.nullable(),
  reason: z.string().min(1),
  registryBaseRevision: z.number().int().nonnegative(),
  reviewedAt: learningDateTimeSchema.nullable(),
  runId: learningUuidSchema,
  status: z.enum(["pending_review", "approved", "rejected"]),
  subjectSha256: learningSha256Schema,
  targetSkillId: learningUuidSchema.nullable(),
  targetSkillRevision: z.number().int().positive().nullable(),
  title: z.string().min(1),
});

/** Full proposed Skill change, including evidence and every bundle file. */
export const learningCandidateDetailSchema = learningCandidateSchema.extend({
  bundle: learningSkillBundleSchema,
  supportingInsights: z.array(
    z.object({
      alias: z.string().min(1),
      id: learningUuidSchema,
      impact: z.string().min(1),
      statement: z.string().min(1),
    }),
  ),
});

/** Result returned after a human or agent reviews a Skill candidate. */
export const learningCandidateReviewSchema = z.object({
  candidateId: learningUuidSchema,
  operation: z.enum(["add", "update", "remove"]),
  publishedRegistryRevision: z.number().int().positive().nullable(),
  publishedSkillId: learningUuidSchema.nullable(),
  status: z.enum(["approved", "rejected"]),
});

export type LearningCandidate = z.infer<typeof learningCandidateSchema>;
export type LearningCandidateDetail = z.infer<
  typeof learningCandidateDetailSchema
>;
export type LearningCandidateReview = z.infer<
  typeof learningCandidateReviewSchema
>;
export interface LearningCandidateRequest extends LearningContainerRequest {
  readonly candidateId: string;
}

export const learningRunSchema = z.object({
  id: z.string().uuid(),
  learningContainerId: learningContainerIdSchema,
  projectId: z.number().int().positive(),
  status: z.enum([
    "queued",
    "freezing",
    "batching",
    "reducing",
    "finalizing",
    "succeeded",
    "failed",
  ]),
  triggerSource: z.enum(["automatic", "manual"]),
  attemptCount: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative().nullable(),
  insightCount: z.number().int().nonnegative().nullable(),
  evidenceThreadCount: z.number().int().nonnegative().nullable().optional(),
  createdAt: learningDateTimeSchema,
  updatedAt: learningDateTimeSchema,
  startedAt: learningDateTimeSchema.nullable(),
  completedAt: learningDateTimeSchema.nullable(),
  failureCode: z.string().nullable(),
  kubernetesJobName: z.string().nullable(),
});
export type LearningRun = z.infer<typeof learningRunSchema>;
const unavailableSchema = z
  .enum(["snapshot-missing", "snapshot-unreadable"])
  .nullable();
export const learningInsightEvidenceSchema = z.union([
  z.object({
    cited: z.array(
      z.object({
        id: z.string(),
        content: z.string(),
        role: z.enum(["assistant", "tool", "user"]),
      }),
    ),
    messageCount: z.number().int().nonnegative(),
    threadId: z.string(),
    threadName: z.string().nullable(),
    threadPresent: z.boolean(),
    unavailable: unavailableSchema,
  }),
  z.object({
    kind: z.literal("trajectory"),
    trajectoryId: z.string().uuid(),
    trajectoryPresent: z.boolean(),
    eventCount: z.number().int().nonnegative(),
    events: z.array(
      z.object({
        seq: z.number().int().nonnegative(),
        name: z.string(),
        offsetMs: z.number(),
        value: z.unknown(),
        eventId: z.string().nullable(),
      }),
    ),
    unavailable: unavailableSchema,
  }),
]);
export type LearningInsightEvidence = z.infer<
  typeof learningInsightEvidenceSchema
>;

/** Validates object IDs independently from container IDs; neither may alter the path. */
export function learningObjectId(id: string): string {
  return z.string().uuid().parse(id);
}
