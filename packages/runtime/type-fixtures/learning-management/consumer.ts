import type {
  CopilotKitIntelligence,
  LearningContainer,
  LearningContainerPage,
  LearningCandidate,
  LearningCandidateDetail,
  LearningCandidateReview,
  LearningInsightEvidence,
  LearningRun,
} from "@copilotkit/runtime/v2";

/** Compile the published declarations under a strict consumer's settings. */
export async function consume(client: CopilotKitIntelligence) {
  const page = await client.listLearningContainers();
  const cursor: string | null = page.nextCursor;
  const space: LearningContainer = page.containers[0];
  const name: string = space.name;
  const prompt: string | null = space.promptContext;
  return { cursor, name, prompt };
}
export const empty: LearningContainerPage = {
  containers: [],
  nextCursor: null,
};
export function inspect(
  candidate: LearningCandidate,
  detail: LearningCandidateDetail,
  review: LearningCandidateReview,
  run: LearningRun,
  evidence: LearningInsightEvidence,
) {
  const title: string = candidate.title;
  const revision: number | null = candidate.publishedRegistryRevision;
  const files: Array<{ path: string; content: string; sha256: string }> =
    detail.bundle.files;
  const skill: string | null = review.publishedSkillId;
  const count: number | null = run.candidateCount;
  const source: string =
    "kind" in evidence ? evidence.trajectoryId : evidence.threadId;
  return { title, revision, files, skill, count, source };
}
// @ts-expect-error Required container fields cannot be omitted.
export const invalid: LearningContainer = {};

// Check explicit published contracts against runtime schemas under strict inference.
import type { z } from "zod";
import {
  learningContainerSchema,
  learningContainerPageSchema,
  learningRunSchema,
  learningCandidateSchema,
  learningCandidateDetailSchema,
  learningCandidateReviewSchema,
  learningInsightEvidenceSchema,
} from "../../src/v2/runtime/intelligence-platform/learning-management";
export const schemas: [
  z.ZodType<LearningContainer>,
  z.ZodType<LearningContainerPage>,
  z.ZodType<LearningRun>,
  z.ZodType<LearningCandidate>,
  z.ZodType<LearningCandidateDetail>,
  z.ZodType<LearningCandidateReview>,
  z.ZodType<LearningInsightEvidence>,
] = [
  learningContainerSchema,
  learningContainerPageSchema,
  learningRunSchema,
  learningCandidateSchema,
  learningCandidateDetailSchema,
  learningCandidateReviewSchema,
  learningInsightEvidenceSchema,
];
