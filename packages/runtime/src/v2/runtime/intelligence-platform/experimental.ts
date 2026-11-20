/** Types for the experimental server-side Learning management API. */
import type {
  LearningContainer,
  LearningContainerPage,
  LearningRun,
  LearningCandidate,
  LearningCandidateDetail,
  LearningCandidateReview,
  LearningInsightEvidence,
  LearningRequestOptions,
  LearningContainerRequest,
  LearningCandidateRequest,
} from "./learning-management";

/** Server-side Learning management operations; call only after authorizing the application user. */
export interface ExperimentalLearningManagement {
  listLearningContainers(
    options?: LearningRequestOptions & { readonly cursor?: string },
  ): Promise<LearningContainerPage>;
  getLearningContainer(
    options: LearningContainerRequest,
  ): Promise<LearningContainer>;
  listLearningRuns(options: LearningContainerRequest): Promise<LearningRun[]>;
  startLearningRun(options: LearningContainerRequest): Promise<LearningRun>;
  listLearningCandidates(
    options: LearningContainerRequest,
  ): Promise<LearningCandidate[]>;
  getLearningCandidate(
    options: LearningCandidateRequest,
  ): Promise<LearningCandidateDetail>;
  getLearningInsightEvidence(
    options: LearningContainerRequest & { readonly insightId: string },
  ): Promise<LearningInsightEvidence[]>;
  reviewLearningCandidate(
    options: LearningCandidateRequest & {
      readonly action: "approve" | "reject";
    },
  ): Promise<LearningCandidateReview>;
}

export type {
  LearningContainer,
  LearningContainerPage,
  LearningRun,
  LearningCandidate,
  LearningCandidateDetail,
  LearningCandidateReview,
  LearningInsightEvidence,
  LearningRequestOptions,
  LearningContainerRequest,
  LearningCandidateRequest,
} from "./learning-management";
