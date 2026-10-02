import type { LearningInsight, LearningSkill } from './learning-api';
import {
  learningTimestamp,
  type LearningContainerState,
} from './learning-container-state';
import { ChevronRightIcon, EvidenceIcon } from './learning-icons';
import styles from './learning-page.module.css';

/**
 * Counts the evidence behind one Insight.
 *
 * An evidence entry groups every cited message from a single Thread, so the
 * entry count is a Thread count. Reporting it as a reference count understates
 * the evidence, which is why both numbers are computed separately here.
 *
 * @param insight - Insight to measure.
 * @returns Cited message and distinct Thread totals.
 */
export function evidenceTotals(insight: LearningInsight): {
  readonly references: number;
  readonly threads: number;
} {
  return {
    references: insight.evidence.reduce(
      (total, reference) => total + reference.messageIds.length,
      0,
    ),
    threads: new Set(insight.evidence.map((reference) => reference.threadId))
      .size,
  };
}

interface InsightsListProps {
  readonly error: string | null;
  readonly insights: readonly LearningInsight[];
  readonly isLoading: boolean;
  readonly onOpenInsight: (insight: LearningInsight) => void;
  readonly proposedSkillFor: (
    insight: LearningInsight,
  ) => LearningSkill | undefined;
  readonly state: LearningContainerState | null;
}

/**
 * Renders the evidence-backed Insights one analysis produced.
 *
 * @param props - Insights, load state, and the row action.
 * @returns The Insight list, or the reason it is empty.
 */
export function InsightsList(props: InsightsListProps): React.JSX.Element {
  if (props.isLoading) {
    return (
      <p className={styles.status} role="status">
        Loading Insights…
      </p>
    );
  }
  if (props.error !== null) {
    return (
      <p className={styles.error} role="alert">
        {props.error}
      </p>
    );
  }
  if (props.insights.length === 0) {
    return (
      <div className={styles.emptyState}>
        <strong>No Insights yet</strong>
        <span>
          {props.state === 'setup'
            ? 'Assign this space ID in your Runtime, then analyze the Threads it collects.'
            : props.state === 'analyzing'
              ? 'The analysis in progress will add any repeated patterns it finds.'
              : 'Analyze the collected Threads to find repeated patterns.'}
        </span>
      </div>
    );
  }

  const withSkills = props.insights.filter(
    (insight) => props.proposedSkillFor(insight) !== undefined,
  ).length;

  return (
    <>
      <div className={styles.listToolbar}>
        <p className={styles.toolbarLabel}>
          {props.insights.length === 1
            ? '1 Insight'
            : `${props.insights.length} Insights`}
          {' · '}
          {withSkills === 1
            ? '1 with a proposed skill'
            : `${withSkills} with proposed skills`}
        </p>
        <p className={styles.toolbarLabel}>Newest first</p>
      </div>
      <ul className={styles.recordList}>
        {props.insights.map((insight) => {
          const totals = evidenceTotals(insight);
          const skill = props.proposedSkillFor(insight);

          return (
            <li key={insight.id}>
              <button
                className={styles.insightRow}
                onClick={() => props.onOpenInsight(insight)}
                type="button"
              >
                <span className={styles.rowBody}>
                  <span className={styles.insightStatement}>
                    {insight.statement}
                  </span>
                  <span className={styles.insightImpact}>{insight.impact}</span>
                  <span className={styles.insightMeta}>
                    <span className={styles.evidenceCount}>
                      <EvidenceIcon />
                      {totals.references === 1
                        ? '1 reference'
                        : `${totals.references} references`}
                      {' in '}
                      {totals.threads === 1
                        ? '1 Thread'
                        : `${totals.threads} Threads`}
                    </span>
                    <span className={styles.insightMetaRight}>
                      <span
                        className={styles.tag}
                        data-variant={skill ? 'skill' : 'insight'}
                      >
                        {skill ? 'Proposed skill' : 'Insight only'}
                      </span>
                      <time dateTime={insight.createdAt}>
                        {learningTimestamp(insight.createdAt)}
                      </time>
                    </span>
                  </span>
                </span>
                <span aria-hidden="true" className={styles.rowChevron}>
                  <ChevronRightIcon />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
