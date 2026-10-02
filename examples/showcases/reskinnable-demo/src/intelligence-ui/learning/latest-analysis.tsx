import { Link } from '../shell/router';
import { Badge } from '../ui/feedback';
import { Button } from '../ui/primitives';
import type { LearningRun } from './learning-api';
import {
  analysisDisplayStatus,
  analysisEvidence,
  analysisOutcome,
  learningTimestampWithZone,
} from './learning-container-state';
import styles from './latest-analysis.module.css';

/** Makes the latest run visible from the default Learning view. */
export function LatestAnalysis(props: {
  readonly run?: LearningRun;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly historyRoute: string;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const run = props.run;
  const status = run ? analysisDisplayStatus(run) : null;
  const timestamp = run?.completedAt ?? run?.startedAt ?? run?.createdAt;
  const title =
    status === 'failed'
      ? 'Analysis failed'
      : status === 'analyzing'
        ? 'Analysis in progress'
        : status === 'retrying'
          ? 'Retrying analysis'
          : 'Latest analysis';
  return (
    <section aria-label="Latest analysis" className={styles.summary}>
      <div className={styles.content} aria-live="polite" aria-atomic="true">
        {props.error !== null ? (
          <p>Could not load the latest analysis.</p>
        ) : props.isLoading ? (
          <p>Loading latest analysis…</p>
        ) : run ? (
          <>
            <div className={styles.heading}>
              <h2>{title}</h2>
              <Badge>
                {run.triggerSource === 'automatic' ? 'Automatic' : 'Manual'}
              </Badge>
              <span className={styles.meta}>
                {run.completedAt
                  ? 'Finished '
                  : run.startedAt
                    ? 'Started '
                    : 'Queued '}
                <time dateTime={timestamp}>
                  {learningTimestampWithZone(timestamp ?? null)}
                </time>
              </span>
            </div>
            <p className={styles.outcome}>{analysisOutcome(run)}</p>
            <p className={styles.meta}>{analysisEvidence(run)}</p>
          </>
        ) : (
          <p>No analyses yet</p>
        )}
      </div>
      {props.error !== null ? (
        <Button onClick={props.onRetry}>Retry latest analysis</Button>
      ) : run && !props.isLoading ? (
        <Link className={styles.link} to={props.historyRoute}>
          View analysis history
        </Link>
      ) : null}
    </section>
  );
}
