/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { WorkspaceLoading } from "../shell/workspace-loading";
import { WorkspacePageHeader } from "../shell/workspace-page-header";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "../shell/router";

import { Button } from "../ui/primitives";

import { ContainerWorkspace } from "./container-workspace";
import { LearningDirectory } from "./learning-directory";
import { isLegacyUnsupportedContainerStats } from "./learning-api";
import type {
  CreateLearningContainerInput,
  LearningApi,
  LearningContainer,
} from "./learning-api";
import type { ContainerProgress } from "./learning-container-state";
import { CreateContainerDialog } from "./learning-dialogs";
import { LearningMarkIcon } from "./learning-icons";
import { LearningOnboardingEmptyState } from "./learning-onboarding-empty-state";
import {
  useLearningRefresh,
  useLearningRefreshSignal,
} from "./learning-refresh-context";
import { learningContainerRoute, learningRoute } from "./learning-routes";
import type { LearningTabSegment } from "./learning-routes";
import { useLearningRequest } from "./use-learning-request";
import styles from "./learning-page.module.css";
import { LocalEvaluationNotice } from "./local-evaluation-notice";
import type { LocalEvaluationStatus } from "./local-evaluation-notice";

interface LearningPageProps {
  readonly api: LearningApi;
  readonly baseRoute: string;
  /** Stable Container id from the route, or `null` on the landing view. */
  readonly containerId: string | null;
  /** Reports the resolved space name to the shell's detail breadcrumb. */
  readonly onBreadcrumbLabelChange?: (label: string | null) => void;
  /** Checks for project data outside Learning containers before onboarding. */
  readonly loadHasExistingData?: (signal: AbortSignal) => Promise<boolean>;
  readonly onRunQueued?: () => void;
  readonly projectId: number;
  readonly tab: LearningTabSegment;
  readonly usageCard?: ReactNode;
  readonly localEvaluation?: LocalEvaluationStatus;
  readonly scheduleCard?: (
    manualAction?: ReactNode,
    renderReadiness?: (nextScheduledRun: ReactNode) => ReactNode,
    presentation?: "summary" | "trigger" | "embedded" | "readiness",
  ) => ReactNode;
}

/** Renders the project-scoped Learning control-plane workspace. */
export function LearningPage(props: LearningPageProps): React.JSX.Element {
  const { api, containerId, projectId } = props;
  const navigate = useNavigate();
  const refresh = useLearningRefresh();
  const refreshSignal = useLearningRefreshSignal();
  const [localRefresh, setLocalRefresh] = useState(0);
  const [existingDataRefresh, setExistingDataRefresh] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoadedIds, setCreateLoadedIds] = useState<readonly string[]>([]);
  const createReturnFocusRef = useRef<HTMLElement | null>(null);
  /**
   * Opens the create dialog.
   *
   * @param loadedIds - Space IDs loaded beyond this page's list, such as the
   *   directory's later pages, refused as duplicates.
   * @param opener - Where focus returns; the focused control when omitted.
   */
  const openCreate = useCallback(
    (
      loadedIds: readonly string[] = [],
      opener: HTMLElement | null = null,
    ): void => {
      createReturnFocusRef.current = opener;
      setCreateLoadedIds(loadedIds);
      setCreateOpen(true);
    },
    [],
  );
  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    openCreate();
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("create");
        return next;
      },
      { replace: true },
    );
  }, [openCreate, searchParams, setSearchParams]);
  const readSignal = refreshSignal + localRefresh;
  // Retrying evidence alone keeps the directory's loaded pages.
  const [statsRefresh, setStatsRefresh] = useState(0);

  const loadContainers = useMemo(
    () => (signal: AbortSignal) => api.listContainers(projectId, { signal }),
    [api, projectId],
  );
  const loadStats = useMemo(
    () => async (signal: AbortSignal) => {
      const projectStats = await api.listContainerStats(projectId, { signal });
      if (
        containerId === null ||
        isLegacyUnsupportedContainerStats(projectStats) ||
        projectStats.some((entry) => entry.containerId === containerId)
      ) {
        return projectStats;
      }

      const selectedStats = await api.listContainerStats(
        projectId,
        { signal },
        containerId,
      );
      return isLegacyUnsupportedContainerStats(selectedStats)
        ? projectStats
        : [...projectStats, ...selectedStats];
    },
    [api, containerId, projectId],
  );
  // Same-project refreshes retain the workspace and any open thread selection.
  const containersState = useLearningRequest(loadContainers, readSignal);
  const statsState = useLearningRequest(loadStats, readSignal + statsRefresh);

  const containerPage =
    containersState.status === "ready" || containersState.status === "empty"
      ? containersState.data
      : { containers: [], nextCursor: null };
  const listedContainers = containerPage.containers;
  const containersResolved =
    containersState.status === "ready" || containersState.status === "empty";

  // A Container can be deep-linked from outside the bounded first page, so the
  // route id is resolved on its own rather than assumed missing.
  const needsRequestedContainer =
    containersResolved &&
    containerId !== null &&
    !listedContainers.some((container) => container.id === containerId);
  const loadRequestedContainer = useMemo(
    () =>
      needsRequestedContainer && containerId !== null
        ? (signal: AbortSignal): Promise<LearningContainer | null> =>
            api.getContainer(projectId, containerId, { signal })
        : null,
    [api, containerId, needsRequestedContainer, projectId],
  );
  const requestedState = useLearningRequest(loadRequestedContainer, readSignal);
  const requestedContainer =
    requestedState.status === "ready" ? requestedState.data : null;

  const containers =
    requestedContainer !== null &&
    !listedContainers.some(
      (container) => container.id === requestedContainer.id,
    )
      ? [...listedContainers, requestedContainer]
      : listedContainers;
  const selectedContainer =
    containerId === null
      ? undefined
      : containers.find((container) => container.id === containerId);
  const { onBreadcrumbLabelChange } = props;
  const selectedName = selectedContainer?.name ?? null;
  useEffect(() => {
    onBreadcrumbLabelChange?.(selectedName);
    return () => onBreadcrumbLabelChange?.(null);
  }, [onBreadcrumbLabelChange, selectedName]);
  const isRequestedLookupPending =
    loadRequestedContainer !== null &&
    (requestedState.status === "idle" || requestedState.status === "loading");

  const statsResult =
    statsState.status === "ready" || statsState.status === "empty"
      ? statsState.data
      : null;
  const legacyStatsUnsupported =
    statsResult !== null && isLegacyUnsupportedContainerStats(statsResult);
  const stats =
    statsResult === null || legacyStatsUnsupported ? [] : statsResult;
  const progressFor = (id: string): ContainerProgress =>
    stats.find((entry) => entry.containerId === id) ?? null;
  // Two different reasons leave a Container's progress unknown, and both are
  // permanent: the stats read failed, or both the bounded project read and the
  // exact-Container fallback returned no row. Either way nothing is still
  // loading, so the copy must not say it is.
  const statsSettled =
    statsState.status === "ready" || statsState.status === "empty";
  const progressUnavailableFor = (id: string): boolean =>
    statsState.status === "error" ||
    (statsSettled && !legacyStatsUnsupported && progressFor(id) === null);

  const hasNoContainers = containersResolved && containers.length === 0;
  const loadExistingData = useMemo(() => {
    const load = props.loadHasExistingData;
    if (!hasNoContainers || load === undefined) return null;
    return async (signal: AbortSignal): Promise<boolean> => load(signal);
  }, [existingDataRefresh, hasNoContainers, props.loadHasExistingData]);
  const existingDataState = useLearningRequest(loadExistingData);
  const isExistingDataLoading =
    hasNoContainers &&
    loadExistingData !== null &&
    (existingDataState.status === "idle" ||
      existingDataState.status === "loading");
  const showOnboarding =
    hasNoContainers &&
    !isExistingDataLoading &&
    existingDataState.status !== "error" &&
    (loadExistingData === null ||
      ((existingDataState.status === "ready" ||
        existingDataState.status === "empty") &&
        !(existingDataState.status === "ready" && existingDataState.data)));

  const markChanged = useCallback((): void => {
    refresh();
    setLocalRefresh((current) => current + 1);
    props.onRunQueued?.();
  }, [props, refresh]);

  const createContainer = useCallback(
    async (input: CreateLearningContainerInput): Promise<void> => {
      const created = await api.createContainer(projectId, input);
      setCreateOpen(false);
      markChanged();
      navigate(learningContainerRoute(props.baseRoute, created.id));
    },
    [api, markChanged, navigate, projectId, props.baseRoute],
  );
  // The project schedule applies with or without a space, so every state
  // without one keeps it in the header.
  const scheduleTrigger = props.scheduleCard?.(undefined, undefined, "trigger");

  return (
    <section
      aria-label="Automatic Learning workspace"
      className={`learning-surface ${styles.page}`}
    >
      <LocalEvaluationNotice status={props.localEvaluation} />
      {/* Empty on plans that do not meter Learning runs, so the slot collapses
          rather than reserving padding above the Container header. */}
      <div className={styles.usageSlot}>{props.usageCard}</div>

      <p
        aria-atomic="true"
        aria-live="polite"
        className="cpki-visually-hidden"
        role="status"
      >
        {containersState.status === "loading"
          ? "Loading Learning Spaces…"
          : isExistingDataLoading
            ? "Checking for existing Automatic Learning data…"
            : hasNoContainers
              ? "No Learning Spaces yet."
              : ""}
      </p>

      {containersState.status === "loading" || isExistingDataLoading ? (
        <div className={styles.onboardingSlot}>
          <WorkspaceLoading />
        </div>
      ) : null}
      {containersState.status === "error" ? (
        <div className={styles.errorState}>
          <p role="alert">{containersState.message}</p>
          <Button
            onClick={() => setLocalRefresh((current) => current + 1)}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}

      {hasNoContainers && existingDataState.status === "error" ? (
        <div className={styles.errorState}>
          <p role="alert">{existingDataState.message}</p>
          <Button
            onClick={() => setExistingDataRefresh((current) => current + 1)}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}

      {/* The surface gives up its padding for the Container workspace, so the
          pre-first-container onboarding brings its own. */}
      {hasNoContainers && showOnboarding ? (
        <div className={styles.onboardingSlot}>
          <WorkspacePageHeader
            actions={scheduleTrigger}
            headingLevel={1}
            title="Automatic Learning"
            titleId="learning-empty-title"
            description="Find patterns in your conversations. Inspect the skills they produce."
          />
          <LearningOnboardingEmptyState
            onCreateRequested={() => openCreate()}
            projectId={projectId}
          />
        </div>
      ) : null}

      {containersResolved &&
      !showOnboarding &&
      !isExistingDataLoading &&
      existingDataState.status !== "error" ? (
        isRequestedLookupPending ? (
          <p className={styles.status} role="status">
            Loading the selected Learning Space…
          </p>
        ) : containerId === null && containers.length > 0 ? (
          <LearningDirectory
            api={api}
            baseRoute={props.baseRoute}
            initialPage={containerPage}
            onCreate={(loadedIds) => openCreate(loadedIds)}
            onRefresh={() => setLocalRefresh((current) => current + 1)}
            onRetryStats={() => setStatsRefresh((current) => current + 1)}
            projectId={projectId}
            schedule={scheduleTrigger}
            stats={stats}
            statsError={
              statsState.status === "error" ? statsState.message : null
            }
          />
        ) : selectedContainer !== undefined ? (
          // Keyed by Container so switching Containers cannot carry over a
          // failed-analysis message or an open Insight drawer belonging to the
          // Container the user just left.
          <ContainerWorkspace
            api={api}
            refreshSignal={readSignal}
            scheduleCard={props.scheduleCard}
            baseRoute={props.baseRoute}
            container={selectedContainer}
            key={selectedContainer.id}
            legacyStatsUnsupported={legacyStatsUnsupported}
            onChanged={markChanged}
            onCreate={(opener) => openCreate([], opener)}
            progress={progressFor(selectedContainer.id)}
            progressUnavailable={progressUnavailableFor(selectedContainer.id)}
            projectId={projectId}
            tab={props.tab}
            localEvaluation={props.localEvaluation}
          />
        ) : (
          <div className={styles.onboardingSlot}>
            {/* The directory is this route, so only a named space links back. */}
            <WorkspacePageHeader
              actions={scheduleTrigger}
              backLink={
                containerId === null
                  ? undefined
                  : {
                      label: "Learning spaces",
                      to: learningRoute(props.baseRoute),
                    }
              }
              description="Find patterns in your conversations. Inspect the skills they produce."
              title="Automatic Learning"
              titleId="learning-landing-title"
            />
            {requestedState.status === "error" ? (
              // The lookup failed, so we do not know whether this Container
              // exists. Saying it "was not found" would report a server or
              // network fault as a deletion, and the offer to create a new
              // one would then be actively wrong advice.
              <div className={styles.landing}>
                <div className={styles.landingCard}>
                  <span className={styles.landingIcon}>
                    <LearningMarkIcon />
                  </span>
                  <h2>Could not load that Learning Space</h2>
                  <p role="alert">{requestedState.message}</p>
                  <p>
                    The lookup failed, so we cannot tell whether it still
                    exists. Retry, or choose another from Learning spaces.
                  </p>
                  <Button
                    onClick={() => setLocalRefresh((current) => current + 1)}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.landing}>
                <div className={styles.landingCard}>
                  <span className={styles.landingIcon}>
                    <LearningMarkIcon />
                  </span>
                  <h2>
                    {containerId === null
                      ? "Choose a Learning Space"
                      : "That Learning Space was not found"}
                  </h2>
                  <p>
                    {containerId === null
                      ? "Create a space to review its evidence, analyze new Threads, and manage its Skills."
                      : "It may have been removed, or it belongs to another project. Choose another from Learning spaces."}
                  </p>
                  <Button onClick={() => openCreate()}>
                    Create a new space
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      ) : null}

      <CreateContainerDialog
        onClose={() => setCreateOpen(false)}
        onCreate={createContainer}
        open={createOpen}
        reservedIds={[
          ...containers.map((container) => container.id),
          ...createLoadedIds,
        ]}
        returnFocusRef={createReturnFocusRef}
      />
    </section>
  );
}
