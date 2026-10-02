import { formatDateTime, parseIsoInstant } from '../ui/datetime';

import type {
  LearningContainerStats,
  LearningRun,
  LearningRunStatus,
} from './learning-api';

/**
 * New Threads a Container should collect before an analysis is worth running.
 *
 * Learning reduces repeated patterns across Threads, so a thin evidence set
 * mostly produces inconclusive Insights. This is a guidance threshold only:
 * every Container can still be analyzed below it after an explicit warning.
 */
export const readyThreadTarget = 15;

const activeRunStatuses = new Set<LearningRunStatus>([
  'queued',
  'freezing',
  'batching',
  'reducing',
  'finalizing',
]);

/** Whether a run is still working, under any of its internal phase names. */
export function isActiveRunStatus(status: LearningRunStatus): boolean {
  return activeRunStatuses.has(status);
}

/**
 * Where a Container sits in the collect-then-analyze loop.
 *
 * `setup` means no Thread has ever named this Container, which is a wiring
 * problem rather than a slow one, so it reads differently from `collecting`.
 */
export type LearningContainerState =
  | 'analyzing'
  | 'collecting'
  | 'ready'
  | 'setup';

/**
 * Evidence progress for one Container, or `null` while stats are unresolved.
 *
 * Stats load for the whole project in one request, so a Container the page has
 * loaded may still have no stats row yet; callers render an unknown state
 * rather than a misleading zero.
 */
export type ContainerProgress = LearningContainerStats | null;

/**
 * Derives the Container's state from its evidence and its latest analysis.
 *
 * An in-flight analysis wins over evidence counts because the pending count is
 * about to change, and a wiring gap wins over a thin evidence set because no
 * amount of waiting fixes it.
 *
 * @param progress - Container stats, or `null` when not yet loaded.
 * @returns The Container state, or `null` when it cannot be derived.
 */
export function containerState(
  progress: ContainerProgress,
): LearningContainerState | null {
  if (progress === null) return null;
  if (
    progress.lastRunStatus !== null &&
    isActiveRunStatus(progress.lastRunStatus)
  ) {
    return 'analyzing';
  }
  if (progress.threadCount === 0) return 'setup';
  return progress.pendingThreadCount >= readyThreadTarget
    ? 'ready'
    : 'collecting';
}

const stateLabels: Record<LearningContainerState, string> = {
  analyzing: 'Analysis in progress',
  collecting: 'Collecting evidence',
  ready: 'Ready to analyze',
  setup: 'Needs setup',
};

/**
 * Returns the reader-facing name for a Container state.
 *
 * A `null` state means the stats read has not answered. `unavailable` splits
 * the two reasons apart: still in flight reads as progress, but a failed read
 * must not keep saying "Checking" forever, because nothing is still checking.
 *
 * @param state - Derived state, or `null` when stats are unresolved.
 * @param options - Set `unavailable` when the stats read failed outright.
 * @returns The label to render.
 */
export function containerStateLabel(
  state: LearningContainerState | null,
  options?: { readonly unavailable?: boolean },
): string {
  if (state !== null) return stateLabels[state];
  return options?.unavailable === true
    ? 'Evidence unknown'
    : 'Checking evidence';
}

/**
 * Explains what the Container is waiting for, in its own terms.
 *
 * @param progress - Container stats, or `null` when not yet loaded.
 * @returns One sentence fragment for the readiness line.
 */
export function containerStateDetail(
  progress: ContainerProgress,
  options?: { readonly unavailable?: boolean },
): string {
  const state = containerState(progress);
  if (progress === null || state === null) {
    return options?.unavailable === true
      ? 'Evidence progress could not be loaded'
      : 'Loading evidence progress…';
  }
  if (state === 'analyzing') {
    return `Analyzing ${progress.pendingThreadCount === 1 ? '1 new Thread' : `${progress.pendingThreadCount} new Threads`}`;
  }
  if (state === 'setup') {
    return 'Assign this space ID in your Runtime to start collecting Threads';
  }
  if (state === 'ready') {
    return `${progress.pendingThreadCount} new Threads available`;
  }
  return `Suggested target: ${readyThreadTarget} new Threads`;
}

/**
 * Fraction of the evidence target already collected, clamped to `[0, 1]`.
 *
 * @param progress - Container stats, or `null` when not yet loaded.
 * @returns Progress toward the next worthwhile analysis.
 */
export function evidenceProgress(progress: ContainerProgress): number {
  if (progress === null) return 0;
  return Math.min(1, progress.pendingThreadCount / readyThreadTarget);
}

/**
 * How an analysis reads to someone who did not write the pipeline.
 *
 * The five internal working phases all report as `analyzing`; a working run
 * that already failed at least once reports as `retrying` so a stalled
 * analysis is distinguishable from a healthy one.
 */
export type AnalysisDisplayStatus =
  | 'analyzing'
  | 'complete'
  | 'failed'
  | 'retrying';

/** Maps one run onto its reader-facing status. */
export function analysisDisplayStatus(
  run: Pick<LearningRun, 'failureCode' | 'status'>,
): AnalysisDisplayStatus {
  if (run.status === 'succeeded') return 'complete';
  if (run.status === 'failed') return 'failed';
  return run.failureCode === null ? 'analyzing' : 'retrying';
}

/**
 * Shortens a run id for display without implying it is the whole id.
 *
 * @param runId - Full run identifier.
 * @returns A stable short label for one analysis.
 */
export function analysisLabel(runId: string): string {
  return `Analysis ${runId.slice(0, 8)}`;
}

/**
 * Summarizes what an analysis produced.
 *
 * Counts come from the run's own persisted result, so a finished run with no
 * findings honestly reports zero rather than falling back to the Container's
 * current totals.
 *
 * @param run - Run to summarize.
 * @returns One phrase describing the outcome.
 */
export function analysisOutcome(
  run: Pick<
    LearningRun,
    'candidateCount' | 'failureCode' | 'insightCount' | 'status'
  >,
): string {
  if (run.status === 'failed') {
    return run.failureCode ?? 'Analysis failed';
  }
  // A run that is still working has no counts yet, which is why absent counts
  // normally read as work in progress. Once it has succeeded that reading is
  // wrong: the counts are absent because this run's stored result predates
  // them, not because it is still going. Say we do not know.
  if (run.insightCount === null || run.candidateCount === null) {
    return run.status === 'succeeded'
      ? 'Outcome unavailable'
      : 'Finding repeated patterns';
  }
  if (run.insightCount === 0 && run.candidateCount === 0) {
    return 'No new Insights or Skill candidates';
  }
  const insights =
    run.insightCount === 1 ? '1 Insight' : `${run.insightCount} Insights`;
  const candidates =
    run.candidateCount === 1
      ? '1 Skill candidate'
      : `${run.candidateCount} Skill candidates`;
  return `${insights} · ${candidates}`;
}

/**
 * Whether a new analysis can be started for this Container.
 *
 * The server allows one active run per Container, and an analysis with no new
 * Threads would only re-derive what the last one already produced, so both
 * cases disable the action rather than failing the request.
 *
 * @param progress - Container stats, or `null` when not yet loaded.
 * @returns Whether to enable the analyze action.
 */
export function canAnalyze(progress: ContainerProgress): boolean {
  return (
    progress !== null &&
    progress.pendingThreadCount > 0 &&
    containerState(progress) !== 'analyzing'
  );
}

/**
 * Formats a Learning timestamp for display, in one place.
 *
 * Wraps the shared `formatDateTime` rather than calling `toLocaleString`
 * directly. Two reasons: Learning timings are read across time zones and
 * pasted into tickets, so they should format the same way as every other
 * timestamp in the product; and a malformed value renders as a fallback
 * instead of the literal string "Invalid Date".
 *
 * @param value - ISO timestamp, or `null` when there is none.
 * @param absentLabel - What to render when there is genuinely no timestamp.
 * @returns A readable timestamp, or `absentLabel`.
 */
export function learningTimestamp(
  value: string | null,
  absentLabel = 'Never',
): string {
  return value === null ? absentLabel : formatDateTime(value);
}

/** Formats the last analysis in the viewer's zone, using that instant's DST offset. */
export function learningTimestampWithZone(
  value: string | null,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  if (value === null) return 'Never';
  const parsed = parseIsoInstant(value);
  if (parsed === null) return formatDateTime(value);
  const zone = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: 'short',
  })
    .formatToParts(parsed)
    .find((part) => part.type === 'timeZoneName')?.value;
  return `${formatDateTime(value, { timeZone })} ${zone}`;
}

/** Describes only the evidence frozen for this run, never current container totals. */
export function analysisEvidence(run: LearningRun): string {
  if (run.evidenceThreadCount == null) return 'Evidence count unavailable';
  return `${run.evidenceThreadCount.toLocaleString()} ${run.evidenceThreadCount === 1 ? 'Thread' : 'Threads'} in this analysis`;
}
