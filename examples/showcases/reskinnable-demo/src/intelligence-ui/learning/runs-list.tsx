import { Button } from '../ui/primitives';
import { Badge } from '../ui/feedback';

import type { LearningRun } from './learning-api';
import type { LearningContainerState } from './learning-container-state';
import {
  analysisDisplayStatus,
  analysisEvidence,
  analysisLabel,
  analysisOutcome,
  learningTimestamp,
} from './learning-container-state';
import styles from './learning-page.module.css';

interface AnalysisResultsListProps {
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly onRetry: () => void;
  readonly runs: readonly LearningRun[];
  readonly state: LearningContainerState | null;
}

/**
 * Renders the Container's analysis history and what each analysis produced.
 *
 * @param props - Analyses and load state.
 * @returns The analysis-results view.
 */
export function AnalysisResultsList(
  props: AnalysisResultsListProps,
): React.JSX.Element {
  if (props.isLoading) {
    return (
      <p className={styles.status} role="status">
        Loading analysis results…
      </p>
    );
  }
  if (props.error !== null) {
    return (
      <div className={styles.errorState}>
        <p className={styles.error} role="alert">
          {props.error}
        </p>
        <Button onClick={props.onRetry}>Retry analysis results</Button>
      </div>
    );
  }
  if (props.runs.length === 0) {
    return (
      <div className={styles.emptyState}>
        <strong>No analysis results yet</strong>
        <span>
          {props.state === 'setup'
            ? 'Assign this space ID in your Runtime, then analyze the Threads it collects.'
            : props.state === 'ready' || props.state === 'collecting'
              ? 'Analyze the collected Threads when you are ready, and each analysis will appear here with what it found.'
              : 'Completed analyses appear here with what each one found.'}
        </span>
      </div>
    );
  }

  return (
    <ul className={styles.recordList}>
      {props.runs.map((run) => {
        const status = analysisDisplayStatus(run);

        return (
          <li className={styles.runRow} key={run.id}>
            <span className={styles.runStatus} data-status={status}>
              {status}
            </span>
            <span className={styles.runIdentity}>
              <span className={styles.runId} title={run.id}>
                {analysisLabel(run.id)}
              </span>
              <Badge>
                {run.triggerSource === 'automatic' ? 'Automatic' : 'Manual'}
              </Badge>
            </span>
            <time className={styles.runDate} dateTime={run.createdAt}>
              {learningTimestamp(run.createdAt)}
            </time>
            <span className={styles.runOutcome}>
              <span>{analysisOutcome(run)}</span>
              <span className={styles.runEvidence}>
                {analysisEvidence(run)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
