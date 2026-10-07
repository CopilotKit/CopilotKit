/* eslint-disable react/no-unescaped-entities, react-hooks/refs -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { ThreadImportEntry } from './thread-import-entry';
import importStyles from './learning-thread-binding.module.css';
import { LearningThreadBinding } from './learning-thread-binding';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '../shell/router';
import { MoreHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { useWorkspaceEntranceMotion } from '../shell/workspace-entrance';
import { WorkspacePageHeader } from '../shell/workspace-page-header';

import { Button } from '../ui/primitives';
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '../ui/overlays';

import { CandidatesList } from './candidates-list';
import { ContainerConnectCard } from './container-connect-card';
import { InsightsList } from './insights-list';
import {
  canAnalyze,
  containerState,
  isActiveRunStatus,
  learningTimestampWithZone,
} from './learning-container-state';
import type { ContainerProgress } from './learning-container-state';
import { AnalyzeThreadsDialog } from './learning-dialogs';
import { InsightDrawer, SkillDrawer } from './learning-drawers';
import { PlayIcon } from './learning-icons';
import type {
  LearningApi,
  LearningContainer,
  LearningInsight,
  LearningInsightEvidence,
  LearningSkill,
} from './learning-api';
import { learningContainerRoute } from './learning-routes';
import type { LearningTabSegment } from './learning-routes';
import { AnalysisResultsList } from './runs-list';
import { LatestAnalysis } from './latest-analysis';
import { SkillsList } from './skills-list';
import { LearningSpaceSettings } from './learning-space-settings';
import { LearningSpaceTabs } from './learning-space-tabs';
import { AutomaticLearning } from './automatic-learning';
import { useLearningRequest } from './use-learning-request';
import { learningNoticeStyles } from './learning-notice';
import styles from './learning-page.module.css';
import type { LocalEvaluationStatus } from './local-evaluation-notice';
import { LearningModelMissingHint } from './learning-model-missing';

/** Owns each tab body's first fade without moving its collection frame. */
function LearningTabPanel(props: {
  readonly children: ReactNode;
  readonly className: string;
  readonly skipEntrance: boolean;
}): React.JSX.Element {
  const entrance = useWorkspaceEntranceMotion(1, true);
  return (
    <motion.div
      className={props.className}
      {...entrance}
      initial={props.skipEntrance ? false : entrance.initial}
    >
      {props.children}
    </motion.div>
  );
}

interface ContainerWorkspaceProps {
  readonly api: LearningApi;
  /** Refreshes data without discarding open product workflows. */
  readonly refreshSignal?: number;
  readonly scheduleCard?: (
    manualAction?: ReactNode,
    renderReadiness?: (nextScheduledRun: ReactNode) => ReactNode,
    presentation?: 'summary' | 'trigger' | 'embedded' | 'readiness',
  ) => ReactNode;
  readonly baseRoute: string;
  readonly container: LearningContainer;
  /** Allows safe run controls when an older app-api has no stats route. */
  readonly legacyStatsUnsupported?: boolean;
  /** Marks Learning data stale so the rail and this view both re-read. */
  readonly onChanged: () => void;
  /** Opens the create dialog; focus returns to `opener` when it closes. */
  readonly onCreate?: (opener: HTMLElement | null) => void;
  readonly progress: ContainerProgress;
  /**
   * Whether the stats read failed, as opposed to still being in flight.
   *
   * `progress` is `null` for both, and the difference matters: one resolves on
   * its own and the other never will, so only one of them may keep saying it
   * is still checking.
   */
  readonly progressUnavailable?: boolean;
  readonly projectId: number;
  readonly tab: LearningTabSegment;
  /** Local evaluation setup facts; a stack without a model cannot start runs. */
  readonly localEvaluation?: LocalEvaluationStatus;
}

/**
 * Renders one Learning Container: its state, its evidence, and its Skills.
 *
 * Every Container view is loaded up front rather than per tab, because the tab
 * strip reports real counts. Four bounded reads buy a header that never lies
 * about how much there is to look at.
 *
 * @param props - Container, its evidence progress, and the selected view.
 * @returns The Container workspace.
 */
export function ContainerWorkspace(
  props: ContainerWorkspaceProps,
): React.JSX.Element {
  const { api, container, onCreate, projectId } = props;
  const loadDelivery = useCallback(
    (signal: AbortSignal) =>
      api.getSkillDelivery?.(projectId, container.id, { signal }) ??
      Promise.resolve(null),
    [api, projectId, container.id],
  );
  const loadAutomation = useCallback(
    (signal: AbortSignal) =>
      api.getAutomation(projectId, container.id, { signal }),
    [api, projectId, container.id, props.progress],
  );
  const containerId = container.id;
  const navigate = useNavigate();
  const [candidateRefresh, setCandidateRefresh] = useState(0);
  const [insightRefresh, setInsightRefresh] = useState(0);
  const [runPollRefresh, setRunPollRefresh] = useState(0);
  const [runRefreshPending, setRunRefreshPending] = useState(false);
  const [threadBindingOpen, setThreadBindingOpen] = useState(false);
  const lastVisibleTabRef = useRef<LearningTabSegment | null>(null);
  useEffect(() => {
    if (!threadBindingOpen) lastVisibleTabRef.current = props.tab;
  }, [props.tab, threadBindingOpen]);
  const threadBindingTrigger = useRef<HTMLButtonElement>(null);
  const threadBindingWasOpen = useRef(false);
  useEffect(() => {
    if (!threadBindingOpen && threadBindingWasOpen.current)
      threadBindingTrigger.current?.focus();
    threadBindingWasOpen.current = threadBindingOpen;
  }, [threadBindingOpen]);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [openInsight, setOpenInsight] = useState<LearningInsight | null>(null);
  const [openSkill, setOpenSkill] = useState<LearningSkill | null>(null);
  const [pendingLinkedSkill, setPendingLinkedSkill] =
    useState<LearningSkill | null>(null);
  const [linkedSkillOpen, setLinkedSkillOpen] = useState(false);
  const insightOpenerRef = useRef<HTMLElement | null>(null);
  // Where the analysis dialog returns focus: the control that opened it.
  const analyzeOpenerRef = useRef<HTMLElement | null>(null);
  /**
   * Opens the analysis dialog and remembers where focus returns afterwards.
   *
   * @param opener - The control that asked; the Actions trigger for its menu item.
   */
  const openAnalyze = (opener: HTMLElement | null): void => {
    analyzeOpenerRef.current = opener;
    setAnalyzeOpen(true);
  };
  const observedActiveRunRef = useRef(false);
  const observedRunIdRef = useRef<string | null | undefined>(undefined);
  const workspaceRef = useRef<HTMLElement>(null);

  // The page scrolls as one, so a reader who was deep in Insights would land
  // mid-list in Skills. Each view starts at its own top instead.
  useEffect(() => {
    let node = workspaceRef.current?.parentElement ?? null;
    while (node !== null) {
      if (node.scrollHeight > node.clientHeight) {
        node.scrollTo({ top: 0 });
        return;
      }
      node = node.parentElement;
    }
  }, [props.tab]);

  const loadInsights = useMemo(
    () => (signal: AbortSignal) =>
      api.listInsights(projectId, containerId, { signal }),
    [api, containerId, projectId],
  );
  const loadSkills = useMemo(
    () => (signal: AbortSignal) =>
      api.listSkills(projectId, containerId, { signal }),
    [api, containerId, projectId],
  );
  const loadRuns = useMemo(
    () => async (signal: AbortSignal) => {
      try {
        return await api.listRuns(projectId, containerId, { signal });
      } finally {
        if (!signal.aborted) setRunRefreshPending(false);
      }
    },
    [api, containerId, projectId],
  );
  const loadCandidates = useMemo(
    () => (signal: AbortSignal) =>
      api.listCandidates(projectId, containerId, { signal }),
    [api, candidateRefresh, containerId, projectId],
  );

  const insightsState = useLearningRequest(
    loadInsights,
    (props.refreshSignal ?? 0) + insightRefresh,
  );
  const skillsState = useLearningRequest(loadSkills, props.refreshSignal ?? 0);
  const runsState = useLearningRequest(
    loadRuns,
    runPollRefresh + (props.refreshSignal ?? 0),
  );
  const candidatesState = useLearningRequest(
    loadCandidates,
    props.refreshSignal ?? 0,
  );

  const insights =
    insightsState.status === 'ready' || insightsState.status === 'empty'
      ? insightsState.data
      : [];
  const skills =
    skillsState.status === 'ready' || skillsState.status === 'empty'
      ? skillsState.data
      : [];
  const runs =
    runsState.status === 'ready' || runsState.status === 'empty'
      ? runsState.data
      : [];
  const candidates =
    candidatesState.status === 'ready' || candidatesState.status === 'empty'
      ? candidatesState.data
      : [];
  const pendingCandidates = candidates.filter(
    (candidate) => candidate.status === 'pending_review',
  );

  const activeRun = runs.find((run) => isActiveRunStatus(run.status));
  const state = containerState(props.progress);
  const displayState = activeRun !== undefined ? 'analyzing' : state;
  const runsResolved =
    runsState.status === 'ready' || runsState.status === 'empty';

  useEffect(() => {
    if (!runsResolved) {
      return undefined;
    }

    if (activeRun !== undefined) {
      observedActiveRunRef.current = true;
      const timeout = window.setTimeout(() => {
        setRunPollRefresh((current) => current + 1);
      }, 2_000);

      return () => window.clearTimeout(timeout);
    }

    if (observedActiveRunRef.current) {
      observedActiveRunRef.current = false;
      props.onChanged();
    }

    return undefined;
  }, [activeRun, props.onChanged, runsResolved, runsState]);

  useEffect(() => {
    if (!runsResolved) return;
    const previousId = observedRunIdRef.current;
    const latest = runs[0];
    observedRunIdRef.current = latest?.id ?? null;
    if (
      previousId !== undefined &&
      latest &&
      previousId !== latest.id &&
      !isActiveRunStatus(latest.status)
    ) {
      props.onChanged();
    }
  }, [runs, runsResolved, props.onChanged]);

  // Runs can start and finish between readiness checks. Re-read history even
  // when no active run was observed, including when returning to the page.
  useEffect(() => {
    const refreshRuns = (): void => {
      if (document.visibilityState !== 'hidden') {
        setRunPollRefresh((current) => current + 1);
      }
    };
    const timer = window.setInterval(refreshRuns, 60_000);
    window.addEventListener('focus', refreshRuns);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshRuns);
    };
  }, []);

  const onRunDetected = useCallback((): void => {
    setRunPollRefresh((current) => current + 1);
    props.onChanged();
  }, [props.onChanged]);

  // A local stack without a model would fail every batch, so no control starts a run.
  const modelMissing = props.localEvaluation?.modelConfigured === false;
  const analyzable =
    !modelMissing &&
    activeRun === undefined &&
    (props.legacyStatsUnsupported === true
      ? runsResolved
      : canAnalyze(props.progress));
  const evidenceUnavailable =
    props.progressUnavailable === true || props.legacyStatsUnsupported === true;

  const loadEvidence = useCallback(
    (
      insightId: string,
      signal: AbortSignal,
    ): Promise<readonly LearningInsightEvidence[]> =>
      api.getInsightEvidence(projectId, containerId, insightId, { signal }),
    [api, containerId, projectId],
  );

  // The confirm dialog stays open and reports its own failure, so re-raising
  // is all this owes the caller. Setting a second page-level message would
  // announce one rejection twice to a screen reader.
  const startAnalysis = useCallback(async (): Promise<void> => {
    await api.runLearning(projectId, containerId);
    // The run opens Analysis results, which replaces a readiness opener, so
    // focus returns to the Actions trigger that stays in the page header.
    analyzeOpenerRef.current = threadBindingTrigger.current;
    setAnalyzeOpen(false);
    setRunPollRefresh((current) => current + 1);
    props.onChanged();
    // The analysis is the thing worth watching now, and Insights cannot change
    // until it finishes, so the reader is taken to where its progress shows.
    navigate(
      learningContainerRoute(props.baseRoute, containerId, 'analysis-results'),
    );
  }, [api, containerId, navigate, projectId, props]);

  const saveSettings = useCallback(
    async (input: {
      readonly name: string;
      readonly promptContext: string | null;
    }): Promise<void> => {
      await api.updateContainer(projectId, containerId, input);
      props.onChanged();
    },
    [api, containerId, projectId, props],
  );

  /** Finds the published Skill an Insight produced, when one exists. */
  const proposedSkillFor = (
    insight: LearningInsight,
  ): LearningSkill | undefined =>
    skills.find((skill) => skill.sourceInsightId === insight.id);

  // A failed list read leaves its array empty, and rendering that as "0" would
  // state a count nothing measured -- worse than useless here, because a
  // reader who sees "Insights 0" has no reason to open the tab that would have
  // shown them the error. Unknown reads as an em dash instead.
  const tabCount = (
    state: { readonly status: string },
    rows: readonly unknown[],
  ): string => (state.status === 'error' ? '—' : String(rows.length));

  const historyResolved =
    (insightsState.status === 'ready' || insightsState.status === 'empty') &&
    (skillsState.status === 'ready' || skillsState.status === 'empty') &&
    (runsState.status === 'ready' || runsState.status === 'empty') &&
    (candidatesState.status === 'ready' || candidatesState.status === 'empty');
  const hasRetainedHistory =
    insights.length > 0 ||
    skills.length > 0 ||
    runs.length > 0 ||
    candidates.length > 0;

  /**
   * Show wiring instructions only after every history read proves that the
   * Container has no retained Learning data.
   */
  const isSetup =
    displayState === 'setup' && historyResolved && !hasRetainedHistory;
  const showSetup = isSetup && props.tab === 'insights';
  // Settings carries its own connect card and schedule, and the setup surface
  // its own schedule, so neither repeats in the header or above the tab body.
  const showConnectReminder =
    !isSetup &&
    props.progress?.hasRuntimeThreads === false &&
    props.tab !== 'settings';
  const showScheduleTrigger = !showSetup && props.tab !== 'settings';

  const tabs: readonly {
    readonly count: string;
    readonly label: string;
    readonly segment: LearningTabSegment;
  }[] = [
    {
      count: tabCount(insightsState, insights),
      label: 'Insights',
      segment: 'insights',
    },
    {
      count: tabCount(skillsState, skills),
      label: 'Skills',
      segment: 'skills',
    },
    {
      count: tabCount(runsState, runs),
      label: 'Analysis results',
      segment: 'analysis-results',
    },
    { count: '', label: 'Settings', segment: 'settings' },
  ];

  /** Why analysis cannot start now, or `null` when it can. */
  const analyzeBlockedReason = modelMissing
    ? null
    : displayState === 'analyzing'
      ? 'Analysis in progress'
      : analyzable
        ? null
        : props.progress === null
          ? 'Analyze unavailable'
          : 'No new Threads';

  // Without a model nothing can run; the readiness card explains why instead.
  const manualAction = modelMissing ? null : (
    <section aria-label="Manual space analysis" className={styles.manualAction}>
      {evidenceUnavailable ? <span>Evidence unknown</span> : null}
      <Button
        disabled={!analyzable}
        onClick={(event) => openAnalyze(event.currentTarget)}
        size="sm"
        variant="primary"
      >
        <PlayIcon />
        {analyzeBlockedReason ?? 'Start manual run now'}
      </Button>
    </section>
  );

  /**
   * Keeps readiness authoritative while the schedule owns its timing data.
   *
   * @param nextScheduledRun - Project timing, shown while the space is eligible.
   * @param action - Control beside the meter; the manual run without a schedule.
   * @returns The readiness notice.
   */
  const renderReadiness = (
    nextScheduledRun?: ReactNode,
    action: ReactNode = props.scheduleCard ? null : manualAction,
  ): ReactNode => (
    <AutomaticLearning
      action={action}
      active={displayState === 'analyzing'}
      facts={
        <dl className={`${learningNoticeStyles.captions} ${styles.runFacts}`}>
          <div>
            <dt>Threads collected</dt>
            <dd>
              {props.progress === null
                ? '—'
                : props.progress.threadCount.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Last analysis</dt>
            <dd>
              {props.progress === null
                ? '—'
                : learningTimestampWithZone(props.progress.lastSucceededAt)}
            </dd>
          </div>
        </dl>
      }
      load={loadAutomation}
      nextScheduledRun={nextScheduledRun}
      offAction={
        <Button
          disabled={!analyzable}
          onClick={(event) => openAnalyze(event.currentTarget)}
          size="sm"
          variant="outline"
        >
          Analyze Threads
        </Button>
      }
      unavailableNotice={
        modelMissing
          ? {
              title: 'No AI model connected',
              description: (
                <>
                  <p>
                    Learning analyzes Threads with a model from your own
                    provider, and this installation doesn't have one yet.
                  </p>
                  <LearningModelMissingHint />
                </>
              ),
            }
          : undefined
      }
      onRunDetected={onRunDetected}
      run={activeRun}
      runsResolved={runsResolved}
    />
  );

  const setupContent =
    props.progress?.hasRuntimeThreads === true ? (
      <p className={styles.help}>
        No threads to show. Start a new conversation in your app to add one.
      </p>
    ) : api.threadBinding ? (
      <ThreadImportEntry
        api={api.threadBinding}
        projectId={projectId}
        containerId={containerId}
        onChoose={() => setThreadBindingOpen(true)}
      >
        <ContainerConnectCard
          compact
          containerId={containerId}
          containerName={container.name}
        />
      </ThreadImportEntry>
    ) : (
      <ContainerConnectCard
        containerId={containerId}
        containerName={container.name}
      />
    );

  // Insights and Skills both close on the latest run and its history link.
  const latestAnalysis = (
    <LatestAnalysis
      run={runs[0]}
      isLoading={runsState.status === 'loading'}
      error={runsState.status === 'error' ? runsState.message : null}
      historyRoute={learningContainerRoute(
        props.baseRoute,
        containerId,
        'analysis-results',
      )}
      onRetry={onRunDetected}
    />
  );

  return (
    <section
      aria-labelledby="learning-container-name"
      className={styles.workspace}
      ref={workspaceRef}
    >
      <div className={styles.containerHeader}>
        <WorkspacePageHeader
          actions={
            <>
              {showScheduleTrigger
                ? props.scheduleCard?.(undefined, undefined, 'trigger')
                : null}
              <MenuRoot modal={false}>
                <MenuTrigger asChild>
                  <Button
                    disabled={threadBindingOpen}
                    ref={threadBindingTrigger}
                    variant="outline"
                  >
                    Actions <MoreHorizontal aria-hidden="true" size={15} />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end" aria-label="Learning Space actions">
                  {api.threadBinding ? (
                    <MenuItem onSelect={() => setThreadBindingOpen(true)}>
                      Import threads
                    </MenuItem>
                  ) : null}
                  <MenuItem
                    disabled={!analyzable}
                    onSelect={() => openAnalyze(threadBindingTrigger.current)}
                  >
                    {modelMissing
                      ? 'Analyze Threads (no AI model connected)'
                      : (analyzeBlockedReason ?? 'Analyze Threads')}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    onSelect={() =>
                      navigate(
                        learningContainerRoute(
                          props.baseRoute,
                          containerId,
                          'settings',
                        ),
                      )
                    }
                  >
                    Space settings
                  </MenuItem>
                  {onCreate ? (
                    <MenuItem
                      onSelect={() => onCreate(threadBindingTrigger.current)}
                    >
                      New Learning Space
                    </MenuItem>
                  ) : null}
                </MenuContent>
              </MenuRoot>
            </>
          }
          backLink={{
            label: 'Learning spaces',
            to: `${props.baseRoute}/learning`,
          }}
          description={
            props.progress === null ||
            typeof props.progress.threadCount !== 'number'
              ? 'Thread count unavailable'
              : `${props.progress.threadCount} ${props.progress.threadCount === 1 ? 'conversation' : 'conversations'} in this Learning Space`
          }
          title={container.name}
          titleId="learning-container-name"
        />

        <LearningSpaceTabs
          baseRoute={props.baseRoute}
          containerId={container.id}
          selected={props.tab}
          tabs={tabs}
        />
      </div>
      {api.threadBinding ? (
        <LearningThreadBinding
          key={`${projectId}:${containerId}`}
          api={api.threadBinding}
          projectId={projectId}
          containerId={containerId}
          containerName={container.name}
          open={threadBindingOpen}
          onClose={() => {
            setThreadBindingOpen(false);
          }}
          onChanged={props.onChanged}
          storageKey={`cpki.thread-binding:${props.baseRoute}:${projectId}:${containerId}`}
        />
      ) : null}

      {!threadBindingOpen ? (
        <LearningTabPanel
          className={`${styles.tabPanel} ${props.tab === 'analysis-results' ? styles.analysisTabPanel : ''}`}
          key={props.tab}
          skipEntrance={lastVisibleTabRef.current === props.tab}
        >
          {showConnectReminder ? (
            <ContainerConnectCard
              inline
              containerId={containerId}
              containerName={container.name}
            />
          ) : null}
          {showSetup ? (
            <div
              className={`${importStyles.setupSurface} ${styles.setupPanel}`}
            >
              {setupContent}
            </div>
          ) : null}
          {showSetup && api.threadBinding ? (
            <details
              className={`${importStyles.sdkDetails} ${styles.scheduleDisclosure}`}
            >
              <summary>Automatic learning schedule</summary>
              <div className={styles.embeddedSchedule}>
                {props.scheduleCard
                  ? props.scheduleCard(manualAction, renderReadiness)
                  : renderReadiness()}
              </div>
            </details>
          ) : null}
          {!showSetup &&
          (props.tab === 'insights' || props.tab === 'analysis-results') ? (
            <section
              className={
                props.tab === 'analysis-results'
                  ? styles.analysisAutomation
                  : undefined
              }
              aria-label="Automatic learning"
            >
              {props.scheduleCard?.(
                undefined,
                (nextScheduledRun) =>
                  renderReadiness(
                    nextScheduledRun,
                    // While a run is in progress the notice already says so.
                    displayState === 'analyzing' ? undefined : manualAction,
                  ),
                'readiness',
              ) ?? renderReadiness()}
            </section>
          ) : null}
          {!showSetup && props.tab === 'insights' ? (
            <>
              <InsightsList
                error={
                  insightsState.status === 'error'
                    ? insightsState.message
                    : null
                }
                insights={insights}
                isLoading={insightsState.status === 'loading'}
                lastSucceededAt={props.progress?.lastSucceededAt}
                onOpenInsight={(insight, opener) => {
                  insightOpenerRef.current = opener;
                  setOpenInsight(insight);
                }}
                onRetry={() => setInsightRefresh((current) => current + 1)}
                proposedSkillFor={proposedSkillFor}
                state={state}
              />
              {latestAnalysis}
            </>
          ) : null}
          {props.tab === 'skills' ? (
            <>
              <SkillsList
                onLoadDelivery={loadDelivery}
                onSetDelivery={(enabled) =>
                  api.setSkillDelivery(projectId, containerId, enabled)
                }
                candidates={(reviewFallbackRef, reportOutcome) => (
                  <CandidatesList
                    baseRoute={props.baseRoute}
                    loadEvidence={loadEvidence}
                    candidates={pendingCandidates}
                    load={(candidateId, signal) =>
                      api.getCandidate(projectId, containerId, candidateId, {
                        signal,
                      })
                    }
                    onReviewed={(outcome) => {
                      reportOutcome(outcome);
                      setCandidateRefresh((current) => current + 1);
                      props.onChanged();
                    }}
                    reviewFallbackRef={reviewFallbackRef}
                    review={(candidateId, action) =>
                      action === 'approve'
                        ? api.approveCandidate(
                            projectId,
                            containerId,
                            candidateId,
                          )
                        : api.rejectCandidate(
                            projectId,
                            containerId,
                            candidateId,
                          )
                    }
                  />
                )}
                candidatesError={
                  candidatesState.status === 'error'
                    ? candidatesState.message
                    : null
                }
                containerId={container.id}
                error={
                  skillsState.status === 'error' ? skillsState.message : null
                }
                isLoading={skillsState.status === 'loading'}
                onOpenSkill={(skill) => {
                  setLinkedSkillOpen(false);
                  setOpenSkill(skill);
                }}
                pendingCandidateCount={pendingCandidates.length}
                skills={skills}
              />
              {latestAnalysis}
            </>
          ) : null}
          {props.tab === 'analysis-results' ? (
            <AnalysisResultsList
              error={runsState.status === 'error' ? runsState.message : null}
              isLoading={runsState.status === 'loading'}
              isRefreshing={runRefreshPending}
              onRetry={() => {
                if (runRefreshPending) return;
                setRunRefreshPending(true);
                onRunDetected();
              }}
              runs={runs}
              state={state}
            />
          ) : null}
          {props.tab === 'settings' ? (
            <LearningSpaceSettings
              connect={
                props.progress?.hasRuntimeThreads === false ? (
                  <ContainerConnectCard
                    card
                    containerId={containerId}
                    containerName={container.name}
                  />
                ) : null
              }
              container={container}
              onLoadDelivery={loadDelivery}
              onSave={saveSettings}
              onSetDelivery={(enabled) =>
                api.setSkillDelivery(projectId, containerId, enabled)
              }
              schedule={props.scheduleCard?.(undefined, undefined, 'embedded')}
            />
          ) : null}
        </LearningTabPanel>
      ) : null}

      {props.progress !== null || props.legacyStatsUnsupported === true ? (
        <AnalyzeThreadsDialog
          onClose={() => setAnalyzeOpen(false)}
          onConfirm={startAnalysis}
          open={analyzeOpen}
          progress={props.progress}
          returnFocusRef={analyzeOpenerRef}
        />
      ) : null}
      {openInsight !== null ? (
        <InsightDrawer
          baseRoute={props.baseRoute}
          closeRequested={pendingLinkedSkill !== null}
          insight={openInsight}
          loadEvidence={loadEvidence}
          onClose={() => {
            setOpenInsight(null);
            if (pendingLinkedSkill !== null) {
              setOpenSkill(pendingLinkedSkill);
              setLinkedSkillOpen(true);
              setPendingLinkedSkill(null);
            }
          }}
          onOpenSkill={(skill) => {
            setPendingLinkedSkill(skill);
          }}
          proposedSkill={proposedSkillFor(openInsight)}
          returnFocusRef={insightOpenerRef}
        />
      ) : null}
      {openSkill !== null ? (
        <SkillDrawer
          baseRoute={props.baseRoute}
          loadEvidence={loadEvidence}
          containerId={container.id}
          onClose={() => {
            setOpenSkill(null);
            setLinkedSkillOpen(false);
          }}
          returnFocusRef={linkedSkillOpen ? insightOpenerRef : undefined}
          skill={openSkill}
        />
      ) : null}
    </section>
  );
}
