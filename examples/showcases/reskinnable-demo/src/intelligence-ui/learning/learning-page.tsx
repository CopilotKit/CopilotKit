import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useEffect } from 'react';
import { useNavigate } from '../shell/router';

import { Button } from '../ui/primitives';

import { ContainerWorkspace } from './container-workspace';
import { isLegacyUnsupportedContainerStats } from './learning-api';
import type {
  CreateLearningContainerInput,
  LearningApi,
  LearningContainer,
} from './learning-api';
import type { ContainerProgress } from './learning-container-state';
import { CreateContainerDialog } from './learning-dialogs';
import { LearningMarkIcon } from './learning-icons';
import {
  useLearningRefresh,
  useLearningRefreshSignal,
} from './learning-refresh-context';
import { learningContainerRoute } from './learning-routes';
import type { LearningTabSegment } from './learning-routes';
import { useLearningRequest } from './use-learning-request';
import styles from './learning-page.module.css';

interface LearningPageProps {
  readonly api: LearningApi;
  readonly baseRoute: string;
  /** Stable Container id from the route, or `null` on the landing view. */
  readonly containerId: string | null;
  /** Checks for project data outside Learning containers before onboarding. */
  readonly loadHasExistingData?: (signal: AbortSignal) => Promise<boolean>;
  readonly onRunQueued?: () => void;
  readonly projectId: number;
  readonly tab: LearningTabSegment;
  readonly usageCard?: ReactNode;
  readonly scheduleCard?: (
    manualAction?: ReactNode,
    renderReadiness?: (nextScheduledRun: ReactNode) => ReactNode,
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
  const [createOpen, setCreateOpen] = useState(false);
  const readSignal = refreshSignal + localRefresh;

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
  const statsState = useLearningRequest(loadStats, readSignal);

  const containerPage =
    containersState.status === 'ready' || containersState.status === 'empty'
      ? containersState.data
      : { containers: [], nextCursor: null };
  const listedContainers = containerPage.containers;
  const containersResolved =
    containersState.status === 'ready' || containersState.status === 'empty';

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
    requestedState.status === 'ready' ? requestedState.data : null;

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
  const isRequestedLookupPending =
    loadRequestedContainer !== null &&
    (requestedState.status === 'idle' || requestedState.status === 'loading');

  const statsResult =
    statsState.status === 'ready' || statsState.status === 'empty'
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
    statsState.status === 'ready' || statsState.status === 'empty';
  const progressUnavailableFor = (id: string): boolean =>
    statsState.status === 'error' ||
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
    (existingDataState.status === 'idle' ||
      existingDataState.status === 'loading');
  const showOnboarding =
    hasNoContainers &&
    !isExistingDataLoading &&
    existingDataState.status !== 'error' &&
    (loadExistingData === null ||
      ((existingDataState.status === 'ready' ||
        existingDataState.status === 'empty') &&
        !(existingDataState.status === 'ready' && existingDataState.data)));

  /*
   * Entering Learning with no Container in the URL opens the first one rather
   * than asking which. The rail is right there showing every Container, so the
   * choice card was a step between the click and the thing the reader came
   * for. Replaced rather than pushed, so Back leaves Learning instead of
   * bouncing off the redirect.
   */
  const firstContainer =
    containerId === null && containersResolved ? containers[0] : undefined;

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

  // Demo: react-router's <Navigate replace> as an effect on the App Router.
  const firstContainerId = firstContainer?.id;
  useEffect(() => {
    if (firstContainerId !== undefined) {
      navigate(learningContainerRoute(props.baseRoute, firstContainerId), { replace: true });
    }
  }, [firstContainerId, navigate, props.baseRoute]);
  if (firstContainer !== undefined) return <></>;

  return (
    <section
      aria-label="Automatic Learning workspace"
      className={`learning-surface ${styles.page}`}
    >
      {/* Empty on plans that do not meter Learning runs, so the slot collapses
          rather than reserving padding above the Container header. */}
      <div className={styles.usageSlot}>{props.usageCard}</div>
      {selectedContainer === undefined ? props.scheduleCard?.() : null}

      <p
        aria-atomic="true"
        aria-live="polite"
        className={
          containersState.status === 'loading' || isExistingDataLoading
            ? styles.status
            : 'cpki-visually-hidden'
        }
        role="status"
      >
        {containersState.status === 'loading'
          ? 'Loading Learning Spaces…'
          : isExistingDataLoading
            ? 'Checking for existing Automatic Learning data…'
            : hasNoContainers
              ? 'No Learning Spaces yet.'
              : ''}
      </p>

      {containersState.status === 'error' ? (
        <div className={styles.errorState}>
          <p role="alert">{containersState.message}</p>
          <Button onClick={() => setLocalRefresh((current) => current + 1)}>
            Retry
          </Button>
        </div>
      ) : null}

      {hasNoContainers && existingDataState.status === 'error' ? (
        <div className={styles.errorState}>
          <p role="alert">{existingDataState.message}</p>
          <Button
            onClick={() => setExistingDataRefresh((current) => current + 1)}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {/* The surface gives up its padding for the Container workspace, so the
          pre-first-container onboarding brings its own. */}
      {/* Demo: the first-space onboarding card is not carried over. */}

      {containersResolved && !showOnboarding ? (
        isRequestedLookupPending ? (
          <p className={styles.status} role="status">
            Loading the selected Learning Space…
          </p>
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
            progress={progressFor(selectedContainer.id)}
            progressUnavailable={progressUnavailableFor(selectedContainer.id)}
            projectId={projectId}
            tab={props.tab}
          />
        ) : requestedState.status === 'error' ? (
          // The lookup failed, so we do not know whether this Container
          // exists. Saying it "was not found" would report a server or network
          // fault as a deletion, and the offer to create a new one would then
          // be actively wrong advice.
          <div className={styles.landing}>
            <div className={styles.landingCard}>
              <span className={styles.landingIcon}>
                <LearningMarkIcon />
              </span>
              <h2>Could not load that Learning Space</h2>
              <p role="alert">{requestedState.message}</p>
              <p>
                The lookup failed, so we cannot tell whether it still exists.
                Retry, or choose another space from the Automatic Learning
                navigation.
              </p>
              <Button onClick={() => setLocalRefresh((current) => current + 1)}>
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
                  ? 'Choose a Learning Space'
                  : 'That Learning Space was not found'}
              </h2>
              <p>
                {containerId === null
                  ? 'Select a space from the Automatic Learning navigation to review its evidence, analyze new Threads, and manage its Skills.'
                  : 'It may have been removed, or it belongs to another project. Choose one from the Automatic Learning navigation.'}
              </p>
              <Button onClick={() => setCreateOpen(true)}>
                Create a new space
              </Button>
            </div>
          </div>
        )
      ) : null}

      <CreateContainerDialog
        onClose={() => setCreateOpen(false)}
        onCreate={createContainer}
        open={createOpen}
        reservedIds={containers.map((container) => container.id)}
      />
    </section>
  );
}

