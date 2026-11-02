import type {
  CopilotKitIntelligence,
  experimental,
} from "@copilotkit/runtime/v2";

type IsAny<T> = 0 extends 1 & T ? true : false;
type ExpectFalse<T extends false> = T;
/** The built client declaration must preserve inferred management response types. */
export type InferredPageIsTyped = ExpectFalse<
  IsAny<
    Awaited<
      ReturnType<
        CopilotKitIntelligence["experimental"]["learning"]["listLearningContainers"]
      >
    >
  >
>;

/** Compile the published declarations under a strict consumer's settings. */
export async function consume(client: CopilotKitIntelligence) {
  const page = await client.experimental.learning.listLearningContainers();
  const cursor: string | null = page.nextCursor;
  const space: experimental.LearningContainer = page.containers[0];
  const name: string = space.name;
  const prompt: string | null = space.promptContext;
  return { cursor, name, prompt };
}
export const empty: experimental.LearningContainerPage = {
  containers: [],
  nextCursor: null,
};
export function inspect(
  candidate: experimental.LearningCandidate,
  detail: experimental.LearningCandidateDetail,
  review: experimental.LearningCandidateReview,
  run: experimental.LearningRun,
  evidence: experimental.LearningInsightEvidence,
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
export const invalid: experimental.LearningContainer = {};

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
  z.ZodType<experimental.LearningContainer>,
  z.ZodType<experimental.LearningContainerPage>,
  z.ZodType<experimental.LearningRun>,
  z.ZodType<experimental.LearningCandidate>,
  z.ZodType<experimental.LearningCandidateDetail>,
  z.ZodType<experimental.LearningCandidateReview>,
  z.ZodType<experimental.LearningInsightEvidence>,
] = [
  learningContainerSchema,
  learningContainerPageSchema,
  learningRunSchema,
  learningCandidateSchema,
  learningCandidateDetailSchema,
  learningCandidateReviewSchema,
  learningInsightEvidenceSchema,
];
