/*
 * Copied from Intelligence apps/app-frontend/react-shell/src/learning/learning-api.ts
 * (main @ b71006350): the Learning schemas and the `LearningApi` interface,
 * unchanged. The hosted adapter is left out; `../ledgerline-learning-api.ts`
 * implements `LearningApi` over this demo's /api/learning/v1 instead.
 */
import { z } from 'zod';
import type { LearningThreadBindingApi } from './learning-thread-binding-api';
import type { LearningMembershipApi } from './learning-membership-api';

/** Inlined from @cpki/app-api-contracts learning-automation.ts (same commit). */
export const learningAutomationReadinessSchema = z.object({
  containerId: z.string().min(1).max(64),
  projectId: z.number().int().positive(),
  enabled: z.boolean(),
  eligibleThreadCount: z.number().int().nonnegative(),
  requiredThreadCount: z.number().int().positive(),
  blocked: z.boolean(),
  activeRun: z.boolean(),
});
export type LearningAutomationReadiness = z.infer<
  typeof learningAutomationReadinessSchema
>;

const stableContainerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const learningContainerSchema = z.object({
  createdAt: z.string(),
  id: stableContainerIdSchema,
  name: z.string().min(1),
  projectId: z.number().int().positive(),
  promptContext: z.string().nullable(),
  updatedAt: z.string(),
});

const learningContainerPageSchema = z.object({
  containers: z.array(learningContainerSchema),
  nextCursor: z.string().min(1).nullable(),
});

const learningRunStatusSchema = z.enum([
  'queued',
  'freezing',
  'batching',
  'reducing',
  'finalizing',
  'succeeded',
  'failed',
]);

const learningContainerStatsSchema = z.object({
  containerId: stableContainerIdSchema,
  lastSucceededAt: z.string().nullable(),
  lastRunStatus: learningRunStatusSchema.nullable(),
  pendingThreadCount: z.number().int().nonnegative(),
  threadCount: z.number().int().nonnegative(),
  unrecoverableRunCount: z.number().int().nonnegative().optional(),
  hasRuntimeThreads: z.boolean().optional(),
});

const evidenceReferenceSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1),
  threadId: z.string().min(1),
});

/*
 * The cited text comes from the run's own frozen snapshot, so a Thread that
 * has since moved on cannot change what an Insight is shown to rest on. When
 * that snapshot is gone the citation still stands and only the quote is
 * missing, which is what `unavailable` distinguishes.
 */
const learningEvidenceMessageSchema = z.object({
  content: z.string(),
  id: z.string().min(1),
  role: z.enum(['assistant', 'tool', 'user']),
});

const learningInsightEvidenceSchema = z.object({
  cited: z.array(learningEvidenceMessageSchema),
  messageCount: z.number().int().nonnegative(),
  threadId: z.string().min(1),
  threadName: z.string().nullable(),
  // False once the cited Thread has left the project, which is what stops the
  // drawer offering a link to a Thread that is no longer there.
  threadPresent: z.boolean(),
  unavailable: z.enum(['snapshot-missing', 'snapshot-unreadable']).nullable(),
});

const learningInsightSchema = z.object({
  alias: z.string().min(1),
  createdAt: z.string(),
  evidence: z.array(evidenceReferenceSchema),
  id: z.string().uuid(),
  impact: z.string().min(1),
  runId: z.string().uuid(),
  skillEligible: z.boolean(),
  statement: z.string().min(1),
});

const supportingInsightSchema = learningInsightSchema.pick({
  alias: true,
  id: true,
  impact: true,
  statement: true,
});

const learningSkillSchema = z.object({
  createdAt: z.string(),
  description: z.string().min(1),
  id: z.string().uuid(),
  name: z.string().min(1),
  revision: z.number().int().positive(),
  skillMd: z.string().min(1),
  sourceInsightId: z.string().uuid(),
  supportingInsights: z.array(supportingInsightSchema).optional(),
  status: z.enum(['published', 'retired']),
  updatedAt: z.string(),
});

const learningRunSchema = z.object({
  attemptCount: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative().nullable().default(null),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  evidenceThreadCount: z.number().int().nonnegative().nullable().optional(),
  failureCode: z.string().nullable(),
  id: z.string().uuid(),
  insightCount: z.number().int().nonnegative().nullable().default(null),
  kubernetesJobName: z.string().nullable(),
  learningContainerId: stableContainerIdSchema,
  projectId: z.number().int().positive(),
  startedAt: z.string().nullable(),
  status: learningRunStatusSchema,
  triggerSource: z.enum(['manual', 'automatic']).default('manual'),
  updatedAt: z.string(),
});

const skillBundleSchema = z.object({
  files: z.array(
    z.object({
      content: z.string(),
      path: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
  ),
  schemaVersion: z.literal(1),
});

const learningCandidateSchema = z.object({
  bundleSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.string(),
  description: z.string().min(1),
  id: z.string().uuid(),
  operation: z.enum(['add', 'update', 'remove']),
  publishedRegistryRevision: z.number().int().positive().nullable(),
  publishedSkillId: z.string().uuid().nullable(),
  reason: z.string().min(1),
  registryBaseRevision: z.number().int().nonnegative(),
  reviewedAt: z.string().nullable(),
  runId: z.string().uuid(),
  status: z.enum(['pending_review', 'approved', 'rejected']),
  subjectSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  targetSkillId: z.string().uuid().nullable(),
  targetSkillRevision: z.number().int().positive().nullable(),
  title: z.string().min(1),
});

const learningCandidateDetailSchema = learningCandidateSchema.extend({
  bundle: skillBundleSchema,
  supportingInsights: z.array(supportingInsightSchema),
});

const learningCandidateReviewSchema = z.object({
  candidateId: z.string().uuid(),
  publishedRegistryRevision: z.number().int().positive().nullable(),
  publishedSkillId: z.string().uuid().nullable(),
  status: z.enum(['approved', 'rejected']),
});

export type LearningContainer = z.infer<typeof learningContainerSchema>;
export type LearningContainerPage = z.infer<typeof learningContainerPageSchema>;
export type LearningContainerStats = z.infer<
  typeof learningContainerStatsSchema
>;

/** Marker returned when an older app-api has no Container stats route. */
export interface LegacyUnsupportedContainerStats {
  readonly status: 'legacy-unsupported';
}

/** Singleton result for an app-api version that predates Container stats. */
export const LEGACY_UNSUPPORTED_CONTAINER_STATS: LegacyUnsupportedContainerStats =
  { status: 'legacy-unsupported' };

/** Container stats rows, or an explicit marker for an older app-api. */
export type LearningContainerStatsResult =
  | readonly LearningContainerStats[]
  | LegacyUnsupportedContainerStats;

/**
 * Checks whether a Container stats result came from an older app-api.
 *
 * @param result - Parsed stats rows or the legacy marker.
 * @returns Whether the stats route is unavailable on this server version.
 */
export function isLegacyUnsupportedContainerStats(
  result: LearningContainerStatsResult,
): result is LegacyUnsupportedContainerStats {
  return !Array.isArray(result);
}

export type LearningRunStatus = z.infer<typeof learningRunStatusSchema>;
export type LearningInsight = z.infer<typeof learningInsightSchema>;
export type LearningSupportingInsight = z.infer<typeof supportingInsightSchema>;
export type LearningSkill = z.infer<typeof learningSkillSchema>;
export type LearningRun = z.infer<typeof learningRunSchema>;
export type LearningCandidate = z.infer<typeof learningCandidateSchema>;
export type LearningCandidateDetail = z.infer<
  typeof learningCandidateDetailSchema
>;
export type LearningCandidateReview = z.infer<
  typeof learningCandidateReviewSchema
>;
export type LearningEvidenceReference = z.infer<typeof evidenceReferenceSchema>;
export type LearningEvidenceMessage = z.infer<
  typeof learningEvidenceMessageSchema
>;
export type LearningInsightEvidence = z.infer<
  typeof learningInsightEvidenceSchema
>;

export interface LearningRequestOptions {
  readonly signal: AbortSignal;
}

export interface CreateLearningContainerInput {
  readonly id: string;
  readonly name: string;
  readonly promptContext: string | null;
}

/** Editable Container settings. The stable id is fixed once Threads bind to it. */
export interface UpdateLearningContainerInput {
  readonly name: string;
  readonly promptContext: string | null;
}

/** Typed browser boundary for project-scoped Learning operations. */
export interface LearningApi {
  readonly threadBinding?: LearningThreadBindingApi;
  readonly memberships?: LearningMembershipApi;
  readonly approveCandidate: (
    projectId: number,
    containerId: string,
    candidateId: string,
  ) => Promise<LearningCandidateReview>;
  readonly createContainer: (
    projectId: number,
    input: CreateLearningContainerInput,
  ) => Promise<LearningContainer>;
  readonly getContainer: (
    projectId: number,
    containerId: string,
    options: LearningRequestOptions,
  ) => Promise<LearningContainer | null>;
  readonly getCandidate: (
    projectId: number,
    containerId: string,
    candidateId: string,
    options: LearningRequestOptions,
  ) => Promise<LearningCandidateDetail>;
  readonly listContainers: (
    projectId: number,
    options: LearningRequestOptions,
    cursor?: string,
  ) => Promise<LearningContainerPage>;
  readonly listContainerStats: (
    projectId: number,
    options: LearningRequestOptions,
    containerId?: string,
  ) => Promise<LearningContainerStatsResult>;
  readonly listCandidates: (
    projectId: number,
    containerId: string,
    options: LearningRequestOptions,
  ) => Promise<readonly LearningCandidate[]>;
  readonly getInsightEvidence: (
    projectId: number,
    containerId: string,
    insightId: string,
    options: LearningRequestOptions,
  ) => Promise<readonly LearningInsightEvidence[]>;
  readonly listInsights: (
    projectId: number,
    containerId: string,
    options: LearningRequestOptions,
  ) => Promise<readonly LearningInsight[]>;
  readonly listRuns: (
    projectId: number,
    containerId: string,
    options: LearningRequestOptions,
  ) => Promise<readonly LearningRun[]>;
  readonly listSkills: (
    projectId: number,
    containerId: string,
    options: LearningRequestOptions,
  ) => Promise<readonly LearningSkill[]>;
  readonly getAutomation: (
    projectId: number,
    containerId: string,
    options: LearningRequestOptions,
  ) => Promise<LearningAutomationReadiness>;
  readonly getSkillDelivery?: (
    projectId: number,
    containerId: string,
    options: LearningRequestOptions,
  ) => Promise<boolean | null>;
  readonly setSkillDelivery: (
    projectId: number,
    containerId: string,
    enabled: boolean,
  ) => Promise<void>;
  readonly runLearning: (
    projectId: number,
    containerId: string,
  ) => Promise<LearningRun>;
  readonly rejectCandidate: (
    projectId: number,
    containerId: string,
    candidateId: string,
  ) => Promise<LearningCandidateReview>;
  readonly updateContainer: (
    projectId: number,
    containerId: string,
    input: UpdateLearningContainerInput,
  ) => Promise<LearningContainer>;
}
