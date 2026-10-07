/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { CodeBlock } from "../ui/data-display";
import { Badge } from "../ui/feedback";
import { ScrollArea } from "../ui/layout";
import { Sheet } from "../ui/overlays";
import { Button } from "../ui/primitives";
import type {
  LearningCandidate,
  LearningCandidateDetail,
  LearningCandidateReview,
} from "./learning-api";
import { learningTimestamp } from "./learning-container-state";
import { SkillEntry, SkillEntryList } from "./skill-entry";
import { SupportingInsights } from "./supporting-insights";
import type { EvidenceLoader } from "./supporting-insights";
import styles from "./candidates-list.module.css";

interface CandidateItemProps {
  readonly baseRoute: string;
  readonly loadEvidence: EvidenceLoader;
  readonly candidate: LearningCandidate;
  readonly load: (signal: AbortSignal) => Promise<LearningCandidateDetail>;
  /** Receives the review's outcome sentence once the review Sheet closes. */
  readonly onReviewed: (outcome: string) => void;
  readonly review: (
    action: "approve" | "reject",
  ) => Promise<LearningCandidateReview>;
  readonly reviewFallbackRef?: RefObject<HTMLElement | null>;
}

/** Names each real candidate operation without implying removal publishes a Skill. */
function operationLabel(operation: LearningCandidate["operation"]): string {
  if (operation === "add") return "Create Skill";
  if (operation === "remove") return "Retire Skill";
  return "Update Skill";
}

/**
 * States what a finished review did, without implying a removal publishes.
 *
 * @param candidate - The reviewed candidate.
 * @param result - The authoritative review response.
 * @returns One sentence for the review status.
 */
function reviewOutcome(
  candidate: LearningCandidate,
  result: LearningCandidateReview,
): string {
  if (result.status === "rejected") return `Rejected ${candidate.title}.`;
  return candidate.operation === "remove"
    ? `Retired ${candidate.title}.`
    : `Published ${candidate.title}.`;
}

/** Keeps a candidate's evidence and review actions in a focus-managed Sheet. */
function CandidateItem(props: CandidateItemProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<LearningCandidateDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const reviewed = useRef(false);
  const outcome = useRef("");
  const opener = useRef<HTMLButtonElement>(null);
  const loadRef = useRef(props.load);
  loadRef.current = props.load;

  useEffect(() => {
    if (!open || detail) return;
    const controller = new AbortController();
    setLoadError(null);
    loadRef.current(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setDetail(value);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Could not load candidate.",
          );
      },
    );
    return () => controller.abort();
  }, [detail, loadAttempt, open]);

  /** Sends the authoritative review mutation once and keeps failures actionable. */
  const review = async (action: "approve" | "reject"): Promise<void> => {
    if (pending) return;
    setPending(true);
    setReviewError(null);
    try {
      outcome.current = reviewOutcome(
        props.candidate,
        await props.review(action),
      );
      reviewed.current = true;
      setOpen(false);
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : "Review failed.");
    } finally {
      setPending(false);
    }
  };

  const proposedFile = detail?.bundle.files.find(
    (file) => file.path === "SKILL.md",
  );
  return (
    <li>
      <SkillEntry
        detail={
          <>
            {operationLabel(props.candidate.operation)} · Proposed{" "}
            {learningTimestamp(props.candidate.createdAt)}
          </>
        }
        onClick={() => {
          reviewed.current = false;
          setOpen(true);
        }}
        ref={opener}
        status={
          <Badge dot variant="accent">
            Pending review
          </Badge>
        }
        title={props.candidate.title}
      />
      <Sheet
        closeLabel="Close Skill review"
        onExited={() => {
          if (reviewed.current) props.onReviewed(outcome.current);
        }}
        onOpenChange={(next) => {
          if (!pending) {
            if (next) reviewed.current = false;
            setOpen(next);
          }
        }}
        open={open}
        returnFocusRef={
          reviewed.current ? (props.reviewFallbackRef ?? opener) : opener
        }
        side="right"
        title={props.candidate.title}
      >
        <div className={styles.sheetHead}>
          <h2>{props.candidate.title}</h2>
          <p>Review the evidence and proposed change.</p>
        </div>
        <ScrollArea
          className={styles.sheetScroll}
          viewportClassName={styles.sheetBody}
        >
          <p className={styles.sheetMeta}>
            {operationLabel(props.candidate.operation)} · Pending review
          </p>
          <p>{props.candidate.description}</p>
          <section>
            <h3>Why this Skill was proposed</h3>
            <p>{props.candidate.reason}</p>
          </section>
          {loadError ? (
            <div role="alert">
              <p>{loadError}</p>
              <Button
                onClick={() => setLoadAttempt((value) => value + 1)}
                variant="outline"
              >
                Retry details
              </Button>
            </div>
          ) : detail ? (
            <>
              <section>
                <h3>Supporting Insights</h3>
                <SupportingInsights
                  baseRoute={props.baseRoute}
                  emptyMessage={
                    detail.operation === "remove"
                      ? "This removal has no supporting Insights. Review the reason above."
                      : undefined
                  }
                  insights={detail.supportingInsights}
                  loadEvidence={props.loadEvidence}
                />
              </section>
              <section>
                <h3>Proposed SKILL.md</h3>
                {proposedFile ? (
                  <CodeBlock code={proposedFile.content} />
                ) : (
                  <p>No SKILL.md in this candidate bundle.</p>
                )}
              </section>
            </>
          ) : (
            <p role="status">Loading Skill evidence…</p>
          )}
        </ScrollArea>
        <div className={styles.sheetFoot}>
          {reviewError ? <p role="alert">{reviewError}</p> : null}
          <Button
            disabled={pending}
            onClick={() => setOpen(false)}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={pending || !detail}
            onClick={() => review("reject")}
            variant="outline"
          >
            Reject
          </Button>
          <Button
            disabled={pending || !detail}
            onClick={() => review("approve")}
            variant="primary"
          >
            {pending
              ? "Saving review…"
              : props.candidate.operation === "remove"
                ? "Approve retirement"
                : "Approve Skill"}
          </Button>
        </div>
      </Sheet>
    </li>
  );
}

/** Presents pending Skill candidates as document rows with real evidence review. */
export function CandidatesList(props: {
  readonly baseRoute: string;
  readonly loadEvidence: EvidenceLoader;
  readonly candidates: readonly LearningCandidate[];
  readonly load: (
    candidateId: string,
    signal: AbortSignal,
  ) => Promise<LearningCandidateDetail>;
  /** Receives the review's outcome sentence once the review Sheet closes. */
  readonly onReviewed: (outcome: string) => void;
  readonly review: (
    candidateId: string,
    action: "approve" | "reject",
  ) => Promise<LearningCandidateReview>;
  readonly reviewFallbackRef?: RefObject<HTMLElement | null>;
}): React.JSX.Element {
  return (
    <SkillEntryList aria-label="Skill candidates">
      {props.candidates.map((candidate) => (
        <CandidateItem
          baseRoute={props.baseRoute}
          loadEvidence={props.loadEvidence}
          candidate={candidate}
          key={candidate.id}
          load={(signal) => props.load(candidate.id, signal)}
          onReviewed={props.onReviewed}
          review={(action) => props.review(candidate.id, action)}
          reviewFallbackRef={props.reviewFallbackRef}
        />
      ))}
    </SkillEntryList>
  );
}
