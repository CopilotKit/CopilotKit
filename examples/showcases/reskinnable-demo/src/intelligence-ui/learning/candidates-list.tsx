import { useState } from 'react';

import { Button } from '../ui/primitives';

import type {
  LearningCandidate,
  LearningCandidateDetail,
  LearningCandidateReview,
} from './learning-api';
import styles from './learning-page.module.css';

function CandidateItem(props: {
  readonly candidate: LearningCandidate;
  readonly load: (signal: AbortSignal) => Promise<LearningCandidateDetail>;
  readonly onReviewed: () => void;
  readonly review: (
    action: 'approve' | 'reject',
  ) => Promise<LearningCandidateReview>;
}): React.JSX.Element {
  const [detail, setDetail] = useState<LearningCandidateDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = (): void => {
    if (detail || pending) return;
    setPending(true);
    setMessage(null);
    props.load(new AbortController().signal).then(
      (value) => {
        setDetail(value);
        setPending(false);
      },
      (error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : 'Could not load candidate.',
        );
        setPending(false);
      },
    );
  };

  const review = (action: 'approve' | 'reject'): void => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    props.review(action).then(
      (result) => {
        setMessage(
          result.status === 'approved'
            ? 'Candidate approved and published.'
            : 'Candidate rejected.',
        );
        setPending(false);
        props.onReviewed();
      },
      (error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'Review failed.');
        setPending(false);
      },
    );
  };

  return (
    <li className={styles.record}>
      <article>
        <div className={styles.recordHeading}>
          <div>
            <h3>{props.candidate.title}</h3>
            <p className={styles.secondary}>{props.candidate.description}</p>
          </div>
          <div className={styles.badges}>
            <span className={styles.badge}>{props.candidate.operation}</span>
            <span className={styles.badge}>
              {props.candidate.status.replace('_', ' ')}
            </span>
          </div>
        </div>
        <p>{props.candidate.reason}</p>
        <div className={styles.reviewActions}>
          <Button
            aria-label={`${detail ? 'Details loaded' : 'View details'} for ${props.candidate.title}`}
            disabled={pending}
            onClick={load}
          >
            {detail ? 'Details loaded' : 'View details'}
          </Button>
          {props.candidate.status === 'pending_review' ? (
            <>
              <Button
                aria-label={`Approve ${props.candidate.title}`}
                disabled={pending}
                onClick={() => review('approve')}
                variant="primary"
              >
                Approve
              </Button>
              <Button
                aria-label={`Reject ${props.candidate.title}`}
                disabled={pending}
                onClick={() => review('reject')}
              >
                Reject
              </Button>
            </>
          ) : null}
        </div>
        {message ? <p role="status">{message}</p> : null}
        {detail ? (
          <div className={styles.candidateDetail}>
            <p>
              Registry base revision {detail.registryBaseRevision}
              {detail.targetSkillRevision
                ? ` · Parent revision ${detail.targetSkillRevision}`
                : ''}
            </p>
            <h4>Supporting Insights</h4>
            {detail.supportingInsights.length === 0 ? (
              <p>None (removal candidate).</p>
            ) : (
              <ul>
                {detail.supportingInsights.map((insight) => (
                  <li key={insight.id}>{insight.statement}</li>
                ))}
              </ul>
            )}
            <details className={styles.skillSource}>
              <summary>View proposed SKILL.md</summary>
              <pre>
                <code>
                  {detail.bundle.files.find((file) => file.path === 'SKILL.md')
                    ?.content ?? ''}
                </code>
              </pre>
            </details>
          </div>
        ) : null}
      </article>
    </li>
  );
}

/** Minimal independent candidate details and approve/reject controls. */
export function CandidatesList(props: {
  readonly candidates: readonly LearningCandidate[];
  readonly load: (
    candidateId: string,
    signal: AbortSignal,
  ) => Promise<LearningCandidateDetail>;
  readonly onReviewed: () => void;
  readonly review: (
    candidateId: string,
    action: 'approve' | 'reject',
  ) => Promise<LearningCandidateReview>;
}): React.JSX.Element {
  if (props.candidates.length === 0) {
    return <p className={styles.empty}>No Skill candidates yet.</p>;
  }
  return (
    <ul className={styles.recordList}>
      {props.candidates.map((candidate) => (
        <CandidateItem
          candidate={candidate}
          key={candidate.id}
          load={(signal) => props.load(candidate.id, signal)}
          onReviewed={props.onReviewed}
          review={(action) => props.review(candidate.id, action)}
        />
      ))}
    </ul>
  );
}
