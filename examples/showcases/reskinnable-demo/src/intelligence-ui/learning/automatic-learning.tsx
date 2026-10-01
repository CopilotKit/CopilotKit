import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { LearningAutomationReadiness } from './learning-api';
import { Button } from '../ui/primitives';
import { useLearningRequest } from './use-learning-request';
import styles from './learning-page.module.css';
import type { LearningRun } from './learning-api';
import { analysisLabel, analysisOutcome } from './learning-container-state';

/** Shows server-owned automatic eligibility independently of manual analysis. */
export function AutomaticLearning(props: {
  readonly load: (signal: AbortSignal) => Promise<LearningAutomationReadiness>;
  readonly active?: boolean;
  /** Project timing is visible only when this container is eligible for dispatch. */
  readonly nextScheduledRun?: ReactNode;
  readonly run?: LearningRun;
  /** Only a successful history read can establish that an active run is missing. */
  readonly runsResolved: boolean;
  /** Refreshes workspace data when readiness discovers a run absent from history. */
  readonly onRunDetected?: () => void;
}): React.JSX.Element {
  const [refresh, setRefresh] = useState(0);
  const state = useLearningRequest(props.load, refresh);
  useEffect(() => {
    const refreshReadiness = () => setRefresh((value) => value + 1);
    const timer = window.setInterval(refreshReadiness, 60_000);
    window.addEventListener('focus', refreshReadiness);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshReadiness);
    };
  }, []);
  const value =
    state.status === 'ready' || state.status === 'empty' ? state.data : null;
  const observedActive = useRef(false);
  useEffect(() => {
    if (!value || !props.runsResolved) return;
    const detected = value.activeRun && !observedActive.current;
    observedActive.current = value.activeRun;
    if (detected && !props.run) props.onRunDetected?.();
  }, [value, props.run, props.runsResolved, props.onRunDetected]);
  const active = props.active || value?.activeRun;
  const remaining = value
    ? Math.max(0, value.requiredThreadCount - value.eligibleThreadCount)
    : 0;
  const eligible =
    value?.enabled && !value.blocked && !active && remaining === 0;
  const label = active
    ? 'Analysis in progress'
    : !value?.enabled
      ? 'Automatic learning is off'
      : value.blocked
        ? 'Waiting for new Threads after a failed run'
        : remaining > 0
          ? `${remaining} more ${remaining === 1 ? 'Thread' : 'Threads'} needed for automatic learning`
          : null;
  return (
    <div
      className={styles.runReadiness}
      role="region"
      aria-label="Automatic run readiness"
    >
      {value || active ? (
        <>
          {label ? <p className={styles.readinessTitle}>{label}</p> : null}
          {eligible ? props.nextScheduledRun : null}
          {active && props.run ? (
            <p className={styles.evidenceScale}>
              <strong>{analysisLabel(props.run.id)}</strong>
              <span>{analysisOutcome(props.run)}</span>
            </p>
          ) : null}
          {active ? (
            <div
              className={styles.evidenceTrack}
              data-analyzing="true"
              role="progressbar"
              aria-label="Thread analysis in progress"
              aria-valuetext="Analyzing the frozen Threads"
            >
              <span className={styles.evidenceFill} />
            </div>
          ) : value ? (
            <>
              <p className={styles.evidenceScale}>
                <span>
                  <strong>
                    {value.eligibleThreadCount} / {value.requiredThreadCount}
                  </strong>{' '}
                  Threads ready
                </span>
              </p>
              <div
                className={styles.evidenceTrack}
                role="progressbar"
                aria-label="Threads for automatic learning"
                aria-valuemin={0}
                aria-valuemax={value.requiredThreadCount}
                aria-valuenow={Math.min(
                  value.eligibleThreadCount,
                  value.requiredThreadCount,
                )}
              >
                <span
                  className={styles.evidenceFill}
                  style={{
                    width: `${Math.min(100, (value.eligibleThreadCount / value.requiredThreadCount) * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : null}
        </>
      ) : state.status === 'error' ? (
        <>
          <p className={styles.learningStateMeta} role="alert">
            Could not check automatic learning.
          </p>
          <Button onClick={() => setRefresh((value) => value + 1)}>
            Retry automatic learning
          </Button>
        </>
      ) : (
        <p className={styles.learningStateMeta} role="status">
          Checking automatic learning…
        </p>
      )}
    </div>
  );
}
