/* eslint-disable react/no-unescaped-entities -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { LearningAutomationReadiness } from "./learning-api";
import { Button } from "../ui/primitives";
import { useLearningRequest } from "./use-learning-request";
import styles from "./learning-page.module.css";
import { learningNoticeStyles } from "./learning-notice";
import type { LearningRun } from "./learning-api";
import { analysisLabel, analysisOutcome } from "./learning-container-state";

/**
 * Shows server-owned automatic eligibility independently of manual analysis.
 *
 * Renders as one compact notice: readiness copy and container facts on the
 * left, the Thread meter and any action on the right.
 *
 * @param props - Readiness loader, run state, schedule timing, facts, and action.
 * @returns The readiness notice region.
 */
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
  /** Container facts shown as captions under the readiness copy. */
  readonly facts?: ReactNode;
  /** Optional action placed beside the readiness meter. */
  readonly action?: ReactNode;
  /**
   * Manual analysis action shown beside the meter while automatic analysis is
   * off for the instance, so the notice points at the way forward. Ignored
   * when `action` is set.
   */
  readonly offAction?: ReactNode;
  /**
   * Explains why no analysis can run at all, such as a missing AI model. It
   * replaces the readiness copy whatever the schedule state, and hides every
   * action, because none of them could work.
   */
  readonly unavailableNotice?: {
    readonly title: string;
    readonly description: ReactNode;
  };
}): React.JSX.Element {
  const [refresh, setRefresh] = useState(0);
  const state = useLearningRequest(props.load, refresh);
  useEffect(() => {
    const refreshReadiness = () => setRefresh((value) => value + 1);
    const timer = window.setInterval(refreshReadiness, 60_000);
    window.addEventListener("focus", refreshReadiness);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshReadiness);
    };
  }, []);
  const value =
    state.status === "ready" || state.status === "empty" ? state.data : null;
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
  const unavailable = active ? undefined : props.unavailableNotice;
  const eligible =
    !unavailable &&
    value?.enabled &&
    !value.blocked &&
    !active &&
    remaining === 0;
  const label = active
    ? "Analysis in progress"
    : unavailable
      ? unavailable.title
      : !value?.enabled
        ? "Automatic analysis is off"
        : value.blocked
          ? "Waiting for new Threads after a failed run"
          : remaining > 0
            ? `${remaining} more ${remaining === 1 ? "Thread" : "Threads"} needed for automatic learning`
            : null;
  const notice = learningNoticeStyles;
  const known = Boolean(value || active);
  // Text and meter change with the read; the facts and the caller's action keep
  // fixed slots so a focused or clicked action is never remounted by a refresh.
  const text = known ? (
    <>
      {label ? <p className={notice.title}>{label}</p> : null}
      {unavailable ? (
        <div className={notice.description}>{unavailable.description}</div>
      ) : !active && value?.enabled === false ? (
        <p className={notice.description}>
          The schedule won't run on this instance. Collected Threads and
          existing results stay available, and you can analyze them manually.
        </p>
      ) : null}
      {eligible ? props.nextScheduledRun : null}
      {active && props.run ? (
        <p className={`${notice.description} ${styles.activeRun}`}>
          <strong>{analysisLabel(props.run.id)}</strong>
          <span>{analysisOutcome(props.run)}</span>
        </p>
      ) : null}
    </>
  ) : state.status === "error" ? (
    <p className={notice.description} role="alert">
      Could not check automatic learning.
    </p>
  ) : (
    <p className={notice.description} role="status">
      Checking automatic learning…
    </p>
  );
  const meter = active ? (
    <div className={styles.readinessMeter}>
      <div
        className={styles.evidenceTrack}
        data-analyzing="true"
        role="progressbar"
        aria-label="Thread analysis in progress"
        aria-valuetext="Analyzing the frozen Threads"
      >
        <span className={styles.evidenceFill} />
      </div>
    </div>
  ) : value ? (
    <div className={styles.readinessMeter}>
      <p className={styles.readinessCount}>
        {value.eligibleThreadCount >= value.requiredThreadCount
          ? `${value.eligibleThreadCount} threads ready`
          : `${value.eligibleThreadCount} of ${value.requiredThreadCount} threads ready`}
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
    </div>
  ) : state.status === "error" ? (
    <Button
      onClick={() => setRefresh((value) => value + 1)}
      size="sm"
      variant="outline"
    >
      Retry automatic learning
    </Button>
  ) : null;
  return (
    <div
      className={`${notice.notice} ${styles.runReadiness}`}
      role="region"
      aria-label="Automatic run readiness"
    >
      <div className={notice.text}>
        {text}
        {props.facts}
      </div>
      <div className={notice.aside}>
        {meter}
        {unavailable
          ? null
          : (props.action ??
            (!active && value?.enabled === false ? props.offAction : null))}
      </div>
    </div>
  );
}
