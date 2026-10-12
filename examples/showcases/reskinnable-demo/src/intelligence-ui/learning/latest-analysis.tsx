import { Link } from "../shell/router";
import { ArrowRight } from "lucide-react";
import { Badge } from "../ui/feedback";
import { Button } from "../ui/primitives";
import type { LearningRun } from "./learning-api";
import {
  analysisDisplayStatus,
  analysisEvidence,
  analysisOutcome,
  learningTimestampWithZone,
} from "./learning-container-state";
import { learningNoticeStyles } from "./learning-notice";
import styles from "./latest-analysis.module.css";

/**
 * Makes the latest run visible from the default Learning view, as the same
 * compact notice the readiness strip uses.
 *
 * Changes are announced through a visually hidden `role="status"` region
 * rather than an `aria-live` attribute on the notice: Radix modals keep
 * `[aria-live]` nodes exposed, which would leak this page behind a dialog.
 *
 * @param props - Latest run, its load state, and the history route.
 * @returns The latest-analysis notice.
 */
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
    status === "failed"
      ? "Analysis failed"
      : status === "analyzing"
        ? "Analysis in progress"
        : status === "retrying"
          ? "Retrying analysis"
          : "Latest analysis";
  const announcement =
    props.error !== null
      ? "Could not load the latest analysis."
      : props.isLoading
        ? "Loading latest analysis…"
        : run
          ? `${title}. ${analysisOutcome(run)}`
          : "No analyses yet";
  const notice = learningNoticeStyles;
  return (
    <>
      <section
        aria-label="Latest analysis"
        className={`${notice.notice} ${styles.summary}`}
      >
        <div className={`${notice.text} ${styles.content}`}>
          {props.error !== null ? (
            <p className={notice.description}>
              Could not load the latest analysis.
            </p>
          ) : props.isLoading ? (
            <p className={notice.description}>Loading latest analysis…</p>
          ) : run ? (
            <>
              <div className={styles.heading}>
                <h2 className={notice.title}>{title}</h2>
                <Badge variant="outline">
                  {run.triggerSource === "automatic" ? "Automatic" : "Manual"}
                </Badge>
                <span className={styles.meta}>
                  {run.completedAt
                    ? "Finished "
                    : run.startedAt
                      ? "Started "
                      : "Queued "}
                  <time dateTime={timestamp}>
                    {learningTimestampWithZone(timestamp ?? null)}
                  </time>
                </span>
              </div>
              <p className={notice.description}>{analysisOutcome(run)}</p>
              <p className={styles.meta}>{analysisEvidence(run)}</p>
            </>
          ) : (
            <p className={notice.description}>No analyses yet</p>
          )}
        </div>
        {props.error !== null ? (
          <div className={notice.aside}>
            <Button onClick={props.onRetry} size="sm" variant="outline">
              Retry latest analysis
            </Button>
          </div>
        ) : run && !props.isLoading ? (
          <div className={notice.aside}>
            <Button asChild size="sm" variant="outline">
              <Link to={props.historyRoute}>
                View analysis history
                <ArrowRight aria-hidden="true" size={14} />
              </Link>
            </Button>
          </div>
        ) : null}
      </section>
      <span className="cpki-visually-hidden" role="status">
        {announcement}
      </span>
    </>
  );
}
