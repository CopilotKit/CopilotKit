import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "../shell/router";

import { Button } from "../ui/primitives";

import { CandidatesList } from "./candidates-list";
import { InsightsList } from "./insights-list";
import {
  canAnalyze,
  containerState,
  isActiveRunStatus,
  learningTimestampWithZone,
} from "./learning-container-state";
import type { ContainerProgress } from "./learning-container-state";
import {
  AnalyzeThreadsDialog,
  ContainerSettingsDialog,
} from "./learning-dialogs";
import { InsightDrawer, SkillDrawer } from "./learning-drawers";
import { PlayIcon } from "./learning-icons";
import type {
  LearningApi,
  LearningContainer,
  LearningInsight,
  LearningInsightEvidence,
  LearningSkill,
} from "./learning-api";
import { learningContainerRoute } from "./learning-routes";
import type { LearningTabSegment } from "./learning-routes";
import { AnalysisResultsList } from "./runs-list";
import { LatestAnalysis } from "./latest-analysis";
import { SkillsList } from "./skills-list";
import { AutomaticLearning } from "./automatic-learning";
import { useLearningRequest } from "./use-learning-request";
import styles from "./learning-page.module.css";

interface ContainerWorkspaceProps {
  readonly api: LearningApi;
  /** Refreshes data without discarding open product workflows. */
  readonly refreshSignal?: number;
  readonly scheduleCard?: (
    manualAction?: ReactNode,
    renderReadiness?: (nextScheduledRun: ReactNode) => ReactNode,
  ) => ReactNode;
  readonly baseRoute: string;
  readonly container: LearningContainer;
  /** Allows safe run controls when an older app-api has no stats route. */
  readonly legacyStatsUnsupported?: boolean;
  /** Marks Learning data stale so the rail and this view both re-read. */
  readonly onChanged: () => void;
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
  const { api, container, projectId } = props;
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
  const [runPollRefresh, setRunPollRefresh] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [threadBindingOpen, setThreadBindingOpen] = useState(false);
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
  const analyzeButtonRef = useRef<HTMLButtonElement>(null);
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
    () => (signal: AbortSignal) =>
      api.listRuns(projectId, containerId, { signal }),
    [api, containerId, projectId],
  );
  const loadCandidates = useMemo(
    () => (signal: AbortSignal) =>
      api.listCandidates(projectId, containerId, { signal }),
    [api, candidateRefresh, containerId, projectId],
  );

  const insightsState = useLearningRequest(
    loadInsights,
    props.refreshSignal ?? 0,
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
    insightsState.status === "ready" || insightsState.status === "empty"
      ? insightsState.data
      : [];
  const skills =
    skillsState.status === "ready" || skillsState.status === "empty"
      ? skillsState.data
      : [];
  const runs =
    runsState.status === "ready" || runsState.status === "empty"
      ? runsState.data
      : [];
  const candidates =
    candidatesState.status === "ready" || candidatesState.status === "empty"
      ? candidatesState.data
      : [];
  const pendingCandidates = candidates.filter(
    (candidate) => candidate.status === "pending_review",
  );

  const activeRun = runs.find((run) => isActiveRunStatus(run.status));
  const state = containerState(props.progress);
  const displayState = activeRun !== undefined ? "analyzing" : state;
  const runsResolved =
    runsState.status === "ready" || runsState.status === "empty";

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
      if (document.visibilityState !== "hidden") {
        setRunPollRefresh((current) => current + 1);
      }
    };
    const timer = window.setInterval(refreshRuns, 60_000);
    window.addEventListener("focus", refreshRuns);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshRuns);
    };
  }, []);

  const onRunDetected = useCallback((): void => {
    setRunPollRefresh((current) => current + 1);
    props.onChanged();
  }, [props.onChanged]);

  const analyzable =
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
    setAnalyzeOpen(false);
    setRunPollRefresh((current) => current + 1);
    props.onChanged();
    // The analysis is the thing worth watching now, and Insights cannot change
    // until it finishes, so the reader is taken to where its progress shows.
    navigate(
      learningContainerRoute(props.baseRoute, containerId, "analysis-results"),
    );
  }, [api, containerId, navigate, projectId, props]);

  const saveSettings = useCallback(
    async (input: {
      readonly name: string;
      readonly promptContext: string | null;
    }): Promise<void> => {
      await api.updateContainer(projectId, containerId, input);
      setSettingsOpen(false);
      props.onChanged();
    },
    [api, containerId, projectId, props],
  );

  /** Finds the published Skill an Insight produced, when one exists. */
  const proposedSkillFor = (
    insight: LearningInsight,
  ): LearningSkill | undefined =>
    skills.find(
      (skill) =>
        skill.sourceInsightId === insight.id ||
        (
          skill as { sourceInsightIds?: readonly string[] }
        ).sourceInsightIds?.includes(insight.id),
    ) ?? candidateSkillFor(insight);

  /**
   * Demo: before review, the Skill candidate an Insight supports is its proposed
   * skill too. The adapter carries the candidate's supporting Insight ids and SKILL.md.
   */
  function candidateSkillFor(
    insight: LearningInsight,
  ): LearningSkill | undefined {
    const candidate = pendingCandidates.find((c) =>
      (
        c as { sourceInsightIds?: readonly string[] }
      ).sourceInsightIds?.includes(insight.id),
    );
    if (candidate === undefined) return undefined;
    return {
      createdAt: candidate.createdAt,
      description: candidate.description,
      id: candidate.id,
      name: candidate.title,
      revision: 1,
      skillMd: (candidate as { skillMd?: string }).skillMd ?? "",
      sourceInsightId: insight.id,
      status: "pending_review",
      updatedAt: candidate.createdAt,
    };
  }

  // A failed list read leaves its array empty, and rendering that as "0" would
  // state a count nothing measured -- worse than useless here, because a
  // reader who sees "Insights 0" has no reason to open the tab that would have
  // shown them the error. Unknown reads as an em dash instead.
  const tabCount = (
    state: { readonly status: string },
    rows: readonly unknown[],
  ): string => (state.status === "error" ? "—" : String(rows.length));

  const historyResolved =
    (insightsState.status === "ready" || insightsState.status === "empty") &&
    (skillsState.status === "ready" || skillsState.status === "empty") &&
    (runsState.status === "ready" || runsState.status === "empty") &&
    (candidatesState.status === "ready" || candidatesState.status === "empty");
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
    displayState === "setup" && historyResolved && !hasRetainedHistory;

  const tabs: readonly {
    readonly count: string;
    readonly label: string;
    readonly segment: LearningTabSegment;
  }[] = [
    {
      count: tabCount(insightsState, insights),
      label: "Insights",
      segment: "insights",
    },
    {
      count: tabCount(skillsState, skills),
      label: "Skills",
      segment: "skills",
    },
    {
      count: tabCount(runsState, runs),
      label: "Analysis results",
      segment: "analysis-results",
    },
  ];

  const manualAction = (
    <section aria-label="Manual space analysis">
      {evidenceUnavailable ? <span>Evidence unknown</span> : null}
      <Button
        disabled={!analyzable}
        onClick={() => setAnalyzeOpen(true)}
        ref={analyzeButtonRef}
        variant="primary"
      >
        <PlayIcon />
        {displayState === "analyzing"
          ? "Analysis in progress"
          : analyzable
            ? "Start manual run now"
            : props.progress === null
              ? "Analyze unavailable"
              : "No new Threads"}
      </Button>
    </section>
  );

  /** Keeps readiness authoritative while the schedule owns its timing data. */
  const renderReadiness = (nextScheduledRun?: ReactNode): ReactNode => (
    <div
      className={styles.runStrip}
      data-scheduled={Boolean(props.scheduleCard)}
    >
      <dl className={styles.runFacts}>
        <div className={styles.runFact}>
          <dt>Threads collected</dt>
          <dd>
            {props.progress === null
              ? "—"
              : props.progress.threadCount.toLocaleString()}
          </dd>
        </div>
        <div className={styles.runFact}>
          <dt>Last analysis</dt>
          <dd>
            {props.progress === null
              ? "—"
              : learningTimestampWithZone(props.progress.lastSucceededAt)}
          </dd>
        </div>
      </dl>
      <AutomaticLearning
        nextScheduledRun={nextScheduledRun}
        onRunDetected={onRunDetected}
        run={activeRun}
        runsResolved={runsResolved}
        load={loadAutomation}
        active={displayState === "analyzing"}
      />
      {!props.scheduleCard ? manualAction : null}
    </div>
  );

  // Demo: the thread-import and SDK-connect cards are not carried over.
  const setupContent = (
    <p className={styles.help}>
      No threads to show. Start a new conversation in your app to add one.
    </p>
  );

  return (
    <section
      aria-labelledby="learning-container-name"
      className={styles.workspace}
      ref={workspaceRef}
    >
      <header className={styles.containerHeader}>
        <div className={styles.containerTitleRow}>
          <div className={styles.containerHeading}>
            <h1 id="learning-container-name">{container.name}</h1>
            <p className={styles.containerId}>{container.id}</p>
          </div>
          <div className={styles.headerActions}>
            <Button onClick={() => setSettingsOpen(true)}>Settings</Button>
          </div>
        </div>

        {!isSetup && props.tab !== "analysis-results" ? (
          <LatestAnalysis
            run={runs[0]}
            isLoading={runsState.status === "loading"}
            error={runsState.status === "error" ? runsState.message : null}
            historyRoute={learningContainerRoute(
              props.baseRoute,
              containerId,
              "analysis-results",
            )}
            onRetry={onRunDetected}
          />
        ) : null}

        <section
          className={styles.automationPanel}
          aria-label="Automatic learning"
        >
          <div className={styles.embeddedSchedule}>
            {props.scheduleCard
              ? props.scheduleCard(manualAction, renderReadiness)
              : renderReadiness()}
          </div>
        </section>

        {isSetup ? null : (
          <nav aria-label="Space views" className={styles.tabs}>
            {tabs.map((tab) => (
              <Link
                aria-current={props.tab === tab.segment ? "page" : undefined}
                className={
                  props.tab === tab.segment ? styles.activeTab : styles.tab
                }
                key={tab.segment}
                to={learningContainerRoute(
                  props.baseRoute,
                  container.id,
                  tab.segment,
                )}
              >
                {tab.label}
                {tab.count ? (
                  <span className={styles.countBadge}>{tab.count}</span>
                ) : null}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {!threadBindingOpen ? (
        <div className={styles.tabPanel}>
          {isSetup ? setupContent : null}
          {!isSetup && props.tab === "insights" ? (
            <InsightsList
              error={
                insightsState.status === "error" ? insightsState.message : null
              }
              insights={insights}
              isLoading={insightsState.status === "loading"}
              onOpenInsight={setOpenInsight}
              proposedSkillFor={proposedSkillFor}
              state={state}
            />
          ) : null}
          {!isSetup && props.tab === "skills" ? (
            <SkillsList
              onLoadDelivery={loadDelivery}
              onSetDelivery={(enabled) =>
                api.setSkillDelivery(projectId, containerId, enabled)
              }
              candidates={
                <CandidatesList
                  candidates={pendingCandidates}
                  load={(candidateId, signal) =>
                    api.getCandidate(projectId, containerId, candidateId, {
                      signal,
                    })
                  }
                  onReviewed={() => {
                    setCandidateRefresh((current) => current + 1);
                    props.onChanged();
                  }}
                  review={(candidateId, action) =>
                    action === "approve"
                      ? api.approveCandidate(
                          projectId,
                          containerId,
                          candidateId,
                        )
                      : api.rejectCandidate(projectId, containerId, candidateId)
                  }
                />
              }
              candidatesError={
                candidatesState.status === "error"
                  ? candidatesState.message
                  : null
              }
              containerId={container.id}
              error={
                skillsState.status === "error" ? skillsState.message : null
              }
              isLoading={skillsState.status === "loading"}
              onOpenSkill={setOpenSkill}
              pendingCandidateCount={pendingCandidates.length}
              skills={skills}
            />
          ) : null}
          {!isSetup && props.tab === "analysis-results" ? (
            <AnalysisResultsList
              error={runsState.status === "error" ? runsState.message : null}
              isLoading={runsState.status === "loading"}
              onRetry={props.onChanged}
              runs={runs}
              state={state}
            />
          ) : null}
        </div>
      ) : null}

      <ContainerSettingsDialog
        container={container}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        open={settingsOpen}
      />
      {props.progress !== null || props.legacyStatsUnsupported === true ? (
        <AnalyzeThreadsDialog
          onClose={() => setAnalyzeOpen(false)}
          onConfirm={startAnalysis}
          open={analyzeOpen}
          progress={props.progress}
        />
      ) : null}
      {openInsight !== null ? (
        <InsightDrawer
          baseRoute={props.baseRoute}
          insight={openInsight}
          loadEvidence={loadEvidence}
          onClose={() => setOpenInsight(null)}
          onOpenSkill={(skill) => {
            setOpenInsight(null);
            setOpenSkill(skill);
          }}
          proposedSkill={proposedSkillFor(openInsight)}
        />
      ) : null}
      {openSkill !== null ? (
        <SkillDrawer
          containerId={container.id}
          onClose={() => setOpenSkill(null)}
          skill={openSkill}
        />
      ) : null}
    </section>
  );
}
