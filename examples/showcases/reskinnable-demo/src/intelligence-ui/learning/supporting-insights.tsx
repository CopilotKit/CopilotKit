import { Button } from '../ui/primitives';
import { useCallback, useId, useState } from 'react';

import { ApiClientError } from '../api-client';

import type {
  LearningInsightEvidence,
  LearningSupportingInsight,
} from './learning-api';
import { EvidenceBrowser } from './learning-evidence-browser';
import { ChevronRightIcon } from './learning-icons';
import { useLearningRequest } from './use-learning-request';
import styles from './supporting-insights.module.css';

export type EvidenceLoader = (
  insightId: string,
  signal: AbortSignal,
) => Promise<readonly LearningInsightEvidence[]>;

/** Loads frozen citations only while their Insight is expanded. */
function InsightEvidence(props: {
  readonly baseRoute: string;
  readonly insightId: string;
  readonly loadEvidence: EvidenceLoader;
}): React.JSX.Element {
  const [refresh, setRefresh] = useState(0);
  const [index, setIndex] = useState(0);
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        return await props.loadEvidence(props.insightId, signal);
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.code === 'LEARNING_INSIGHT_NOT_FOUND'
        ) {
          return null;
        }
        throw error;
      }
    },
    [props.insightId, props.loadEvidence],
  );
  const state = useLearningRequest(load, refresh);
  const evidence =
    state.status === 'ready' || state.status === 'empty'
      ? (state.data ?? [])
      : [];

  if (state.status === 'ready' && state.data === null) {
    return (
      <p className={styles.impact}>
        This Insight was archived or is no longer available.
      </p>
    );
  }

  return (
    <div className={styles.evidence}>
      <EvidenceBrowser
        baseRoute={props.baseRoute}
        evidence={evidence}
        index={Math.min(index, Math.max(0, evidence.length - 1))}
        onSelect={setIndex}
        state={
          state.status === 'error'
            ? 'error'
            : state.status === 'ready' || state.status === 'empty'
              ? 'ready'
              : 'loading'
        }
      />
      {state.status === 'error' ? (
        <Button onClick={() => setRefresh((value) => value + 1)}>
          Retry evidence
        </Button>
      ) : null}
    </div>
  );
}

/** Discloses one supporting Insight without leaving the review or Skill. */
function SupportingInsight(props: {
  readonly baseRoute: string;
  readonly insight: LearningSupportingInsight;
  readonly loadEvidence: EvidenceLoader;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  return (
    <li className={styles.insight}>
      <button
        aria-controls={expanded ? panelId : undefined}
        aria-expanded={expanded}
        aria-label={`View evidence: ${props.insight.statement}`}
        className={styles.disclosure}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span aria-hidden="true" className={styles.chevron}>
          <ChevronRightIcon />
        </span>
        <span>{props.insight.statement}</span>
      </button>
      {expanded ? (
        <div className={styles.content} id={panelId}>
          <p className={styles.impact}>{props.insight.impact}</p>
          <InsightEvidence
            baseRoute={props.baseRoute}
            insightId={props.insight.id}
            loadEvidence={props.loadEvidence}
          />
        </div>
      ) : null}
    </li>
  );
}

/** Shows recorded source Insights with on-demand quotes and scoped Thread links. */
export function SupportingInsights(props: {
  readonly baseRoute: string;
  readonly emptyMessage?: string;
  readonly insights: readonly LearningSupportingInsight[];
  readonly loadEvidence: EvidenceLoader;
}): React.JSX.Element {
  if (props.insights.length === 0) {
    return (
      <p className={styles.impact}>
        {props.emptyMessage ?? 'No supporting Insights are available.'}
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {props.insights.map((insight) => (
        <SupportingInsight
          baseRoute={props.baseRoute}
          insight={insight}
          key={insight.id}
          loadEvidence={props.loadEvidence}
        />
      ))}
    </ul>
  );
}
