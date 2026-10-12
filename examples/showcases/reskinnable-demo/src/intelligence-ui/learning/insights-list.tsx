import type { LearningInsight, LearningSkill } from "./learning-api";
import { Button } from "../ui/primitives";
import { Badge, EmptyState } from "../ui/feedback";
import { Lightbulb } from "lucide-react";
import { learningTimestamp } from "./learning-container-state";
import type { LearningContainerState } from "./learning-container-state";
import {
  citedThreadsLabel,
  FindingDate,
  FindingEvidence,
  FindingList,
  FindingRow,
  referencesLabel,
} from "./finding-list";
import styles from "./learning-page.module.css";

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
  readonly lastSucceededAt?: string | null;
  readonly onOpenInsight: (
    insight: LearningInsight,
    opener: HTMLButtonElement,
  ) => void;
  readonly onRetry: () => void;
  readonly proposedSkillFor: (
    insight: LearningInsight,
  ) => LearningSkill | undefined;
  readonly state: LearningContainerState | null;
}

/**
 * Renders the evidence-backed Insights one analysis produced.
 *
 * Rows share the Product Insights row: the status badge sits in the chip line
 * where Product Insights shows its Learning Space, then the title, description,
 * and a caption line with the cited Threads, references, and date.
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
      <div className={styles.errorState}>
        <p className={styles.error} role="alert">
          {props.error}
        </p>
        <Button onClick={props.onRetry} size="sm" variant="outline">
          Retry Insights
        </Button>
      </div>
    );
  }
  if (props.insights.length === 0) {
    return (
      <EmptyState
        description={
          props.state === "setup"
            ? "Assign this space ID in your Runtime, then analyze the Threads it collects."
            : props.state === "analyzing"
              ? "The analysis in progress will add any repeated patterns it finds."
              : "Analyze the collected Threads to find repeated patterns."
        }
        headingLevel={2}
        icon={<Lightbulb />}
        title="No Insights yet"
        variant="collection"
      />
    );
  }

  return (
    <section className={styles.insightsSection} aria-label="Insights">
      <div className={styles.sectionCaption}>
        <p>
          Last analysis · {learningTimestamp(props.lastSucceededAt ?? null)}
        </p>
        <p>
          {props.insights.length === 1
            ? "1 Insight"
            : `${props.insights.length} Insights`}
        </p>
      </div>
      <FindingList aria-label="Learning Space Insights" bordered>
        {props.insights.map((insight) => {
          const totals = evidenceTotals(insight);
          const skill = props.proposedSkillFor(insight);

          return (
            <FindingRow
              description={insight.impact}
              key={insight.id}
              meta={
                <>
                  <FindingEvidence label={citedThreadsLabel(totals.threads)} />
                  <span>{referencesLabel(totals.references)}</span>
                  <FindingDate value={insight.createdAt} />
                </>
              }
              onOpen={(opener) => props.onOpenInsight(insight, opener)}
              status={
                skill ? (
                  <Badge variant="accent">Proposed skill</Badge>
                ) : (
                  <Badge variant="neutral">Insight only</Badge>
                )
              }
              title={insight.statement}
            />
          );
        })}
      </FindingList>
    </section>
  );
}
