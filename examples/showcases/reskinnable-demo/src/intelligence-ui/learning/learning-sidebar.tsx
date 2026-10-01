/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from '../shell/router';
import { Button, IconButton } from '../ui/primitives';

import { PlusIcon } from './learning-icons';
import { isLegacyUnsupportedContainerStats } from './learning-api';
import type {
  CreateLearningContainerInput,
  LearningApi,
  LearningContainer,
  LearningContainerPage,
  LearningContainerStats,
  LearningContainerStatsResult,
} from './learning-api';
import {
  containerState,
  containerStateLabel,
} from './learning-container-state';
import type { LearningContainerState } from './learning-container-state';
import { CreateContainerDialog } from './learning-dialogs';
import {
  useLearningRefresh,
  useLearningRefreshSignal,
} from './learning-refresh-context';
import { learningContainerRoute } from './learning-routes';
import { useLearningRequest } from './use-learning-request';
import styles from './learning-sidebar.module.css';

/**
 * Reads the Container the URL is pointing at.
 *
 * The rail renders in the shell's sidebar slot, above the Learning route tree,
 * so it has no route params to read and must parse the path itself. Anchored on
 * the project base route rather than searching for `/learning/`, because a
 * project whose own slug is `learning` would otherwise match its own segment
 * and highlight a Container named after the project.
 *
 * @param pathname - Current location pathname.
 * @param baseRoute - Project base route the Learning surface hangs off.
 * @returns The active Container id, or `null` outside a Container route.
 */
function activeContainerId(pathname: string, baseRoute: string): string | null {
  const prefix = `${baseRoute}/learning/`;
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split('/')[0]?.trim();
  if (segment === undefined || segment.length === 0) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    // A hand-typed path can carry a malformed escape; match it literally.
    return segment;
  }
}

/**
 * Summarizes a Container's evidence in the few characters the rail has.
 *
 * @param stats - Container stats, or `null` while stats are unresolved.
 * @returns A short phrase, or `null` when there is nothing honest to say.
 */
function threadSummary(stats: LearningContainerStats | null): string | null {
  if (stats === null) return null;
  if (stats.threadCount === 0) return 'No Threads';
  // An analysis has already frozen its input, so those Threads are the ones
  // being read rather than ones still waiting to be.
  return containerState(stats) === 'analyzing'
    ? `${stats.pendingThreadCount} Threads`
    : `${stats.pendingThreadCount} new`;
}

const stateClassNames: Record<LearningContainerState, string> = {
  analyzing: styles.stateAnalyzing,
  collecting: styles.stateCollecting,
  ready: styles.stateReady,
  setup: styles.stateSetup,
};

/** Returns the state class that tints one Container's status dot. */
function stateClassName(state: LearningContainerState | null): string {
  return state === null ? styles.stateUnknown : stateClassNames[state];
}

/**
 * Renders the dedicated Learning rail that replaces the primary sidebar.
 *
 * Learning is a two-level surface: pick a Container, then work inside it. The
 * rail owns the first level and loads its own data, because it lives outside
 * the Learning route tree and must survive any single page failing.
 *
 * @param props - Authenticated client, project base route, and project id.
 * @returns The Automatic Learning navigation rail.
 */
export function LearningSidebar(props: {
  /** Demo: the Learning adapter is passed in rather than built from a hosted client. */
  readonly api: LearningApi;
  readonly baseRoute: string;
  readonly projectId: number;
}): React.JSX.Element {
  const api = props.api;
  const navigate = useNavigate();
  const location = useLocation();
  const refreshSignal = useLearningRefreshSignal();
  const refreshLearning = useLearningRefresh();
  const labelId = useId();
  const [reloadToken, setReloadToken] = useState(0);
  const [isCreateOpen, setCreateOpen] = useState(false);
  // Containers arrive one bounded page at a time. The rail is the only place
  // Containers are listed, so it has to be able to reach past the first page.
  const [extraPages, setExtraPages] = useState<
    readonly LearningContainerPage[]
  >([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isPageLoading, setPageLoading] = useState(false);
  const pageController = useRef<AbortController | null>(null);

  const loadContainers = useMemo(
    () =>
      (signal: AbortSignal): Promise<LearningContainerPage> =>
        api.listContainers(props.projectId, { signal }),
    [api, props.projectId, refreshSignal, reloadToken],
  );
  const loadStats = useMemo(
    () =>
      (signal: AbortSignal): Promise<LearningContainerStatsResult> =>
        api.listContainerStats(props.projectId, { signal }),
    [api, props.projectId, refreshSignal, reloadToken],
  );
  const containersState = useLearningRequest(loadContainers);
  const statsState = useLearningRequest(loadStats);

  // A reload replaces the request state with `loading`, which would blank the
  // rail the user is navigating with. The last settled page is kept so a
  // refresh updates the list in place instead of emptying it.
  const [settledPage, setSettledPage] = useState<LearningContainerPage | null>(
    null,
  );
  const resolvedPage =
    containersState.status === 'ready' || containersState.status === 'empty'
      ? containersState.data
      : null;

  useEffect(() => {
    if (resolvedPage !== null) setSettledPage(resolvedPage);
  }, [resolvedPage]);

  const firstPage: LearningContainerPage = resolvedPage ??
    settledPage ?? { containers: [], nextCursor: null };
  const containers: readonly LearningContainer[] = useMemo(() => {
    const seen = new Set<string>();
    return [firstPage, ...extraPages]
      .flatMap((page) => page.containers)
      .filter((container) => {
        if (seen.has(container.id)) return false;
        seen.add(container.id);
        return true;
      });
  }, [extraPages, firstPage]);
  const nextCursor = (extraPages.at(-1) ?? firstPage).nextCursor;

  // A fresh first page invalidates everything appended after it: a Container
  // deleted server-side would otherwise survive in a stale appended page.
  const resetPages = useCallback((): void => {
    pageController.current?.abort();
    pageController.current = null;
    setExtraPages([]);
    setPageError(null);
    setPageLoading(false);
  }, []);

  useEffect(() => {
    resetPages();
  }, [refreshSignal, reloadToken, resetPages]);

  useEffect(
    () => () => {
      pageController.current?.abort();
    },
    [],
  );

  const loadMoreContainers = useCallback((): void => {
    if (nextCursor === null || isPageLoading) return;
    const controller = new AbortController();
    pageController.current?.abort();
    pageController.current = controller;
    setPageLoading(true);
    setPageError(null);
    api
      .listContainers(
        props.projectId,
        { signal: controller.signal },
        nextCursor,
      )
      .then(
        (page) => {
          if (controller.signal.aborted) return;
          setExtraPages((current) => [...current, page]);
          setPageLoading(false);
          pageController.current = null;
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setPageError(
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Could not load more Learning Spaces.',
          );
          setPageLoading(false);
          pageController.current = null;
        },
      );
  }, [api, isPageLoading, nextCursor, props.projectId]);
  // Stats are advisory: a failed stats read degrades to an unknown state
  // rather than hiding the navigation the user came here for.
  const statsSettled =
    statsState.status === 'ready' || statsState.status === 'empty';
  const statsResult = statsSettled ? statsState.data : null;
  const legacyStatsUnsupported =
    statsResult !== null && isLegacyUnsupportedContainerStats(statsResult);
  const statsById = useMemo(() => {
    const rows =
      statsResult === null || legacyStatsUnsupported ? [] : statsResult;
    return new Map(rows.map((row) => [row.containerId, row]));
  }, [legacyStatsUnsupported, statsResult]);

  const selectedContainerId = activeContainerId(
    location.pathname,
    props.baseRoute,
  );
  const reservedIds = useMemo(
    () => containers.map((container) => container.id),
    [containers],
  );

  const createContainer = useCallback(
    async (input: CreateLearningContainerInput): Promise<void> => {
      // A rejection is the dialog's to report, so it is not caught here.
      const created = await api.createContainer(props.projectId, input);
      setCreateOpen(false);
      resetPages();
      // Invalidate through the shared signal, not just locally: the Learning
      // page is listing this project's Containers too and would otherwise keep
      // showing a landing state that no longer reflects the project.
      refreshLearning();
      setReloadToken((current) => current + 1);
      navigate(learningContainerRoute(props.baseRoute, created.id));
    },
    [
      api,
      navigate,
      props.baseRoute,
      props.projectId,
      refreshLearning,
      resetPages,
    ],
  );

  const isLoading =
    containersState.status === 'idle' || containersState.status === 'loading';
  // Only announce loading when there is nothing to navigate with yet. A
  // background refresh keeps the settled list on screen.
  const isFirstLoad = isLoading && containers.length === 0;

  return (
    <div
      aria-label="Automatic Learning navigation"
      className={`shell-sidebar ${styles.rail}`}
      role="complementary"
    >
      <div className={styles.top}>
        <Link className={styles.exit} to={`${props.baseRoute}/overview`}>
          <span aria-hidden="true">&#8592;</span>
          <span>Exit Automatic Learning</span>
        </Link>
      </div>

      <section aria-labelledby={labelId} className={styles.section}>
        <div className={styles.sectionLabel}>
          <span id={labelId}>Learning Spaces</span>
          <IconButton
            className={styles.addButton}
            label="Create Learning Space"
            onClick={() => setCreateOpen(true)}
            size="sm"
          >
            <PlusIcon />
          </IconButton>
        </div>

        {isFirstLoad ? (
          <p aria-live="polite" className={styles.status} role="status">
            Loading Learning Spaces…
          </p>
        ) : null}

        {containersState.status === 'error' ? (
          <div className={styles.errorState}>
            <p className={styles.errorMessage} role="alert">
              {containersState.message}
            </p>
            <Button
              onClick={() => {
                resetPages();
                setReloadToken((current) => current + 1);
              }}
              size="sm"
            >
              Retry
            </Button>
          </div>
        ) : null}

        {statsState.status === 'error' ? (
          <p className={styles.errorMessage} role="alert">
            {statsState.message}
          </p>
        ) : null}

        {containers.length > 0 ? (
          <nav aria-label="Learning Spaces" className={styles.nav}>
            {containers.map((container) => {
              const stats = statsById.get(container.id) ?? null;
              const state = containerState(stats);
              const summary = threadSummary(stats);
              const isActive = container.id === selectedContainerId;

              return (
                <Link
                  aria-current={isActive ? 'location' : undefined}
                  className={
                    isActive
                      ? `${styles.link} ${styles.activeLink}`
                      : styles.link
                  }
                  key={container.id}
                  to={learningContainerRoute(
                    props.baseRoute,
                    container.id,
                    state === 'analyzing' ? 'analysis-results' : 'insights',
                  )}
                >
                  <span className={styles.name}>{container.name}</span>
                  {stats?.unrecoverableRunCount !== undefined &&
                  stats.unrecoverableRunCount > 0 ? (
                    <span className={styles.unavailableHistory}>
                      {stats.unrecoverableRunCount.toLocaleString()}{' '}
                      {stats.unrecoverableRunCount === 1
                        ? 'earlier run could not be recovered because its events are unavailable.'
                        : 'earlier runs could not be recovered because their events are unavailable.'}
                    </span>
                  ) : null}
                  <span className={styles.statusLine}>
                    <span
                      className={`${styles.state} ${stateClassName(state)}`}
                    >
                      <span aria-hidden="true" className={styles.dot} />
                      <span className={styles.stateLabel}>
                        {containerStateLabel(state, {
                          // Unknown for good: either the stats read failed, or
                          // it succeeded without a row for this Container.
                          // Neither is still in flight.
                          unavailable:
                            legacyStatsUnsupported ||
                            statsState.status === 'error' ||
                            (statsSettled && stats === null),
                        })}
                      </span>
                    </span>
                    {summary === null ? null : (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={styles.threadSummary}>{summary}</span>
                      </>
                    )}
                  </span>
                </Link>
              );
            })}
          </nav>
        ) : null}

        {nextCursor !== null ? (
          <Button
            disabled={isPageLoading}
            onClick={loadMoreContainers}
            size="sm"
          >
            {isPageLoading ? 'Loading spaces…' : 'Load more spaces'}
          </Button>
        ) : null}

        {pageError !== null ? (
          <p className={styles.errorMessage} role="alert">
            {pageError}
          </p>
        ) : null}

        {!isLoading &&
        containersState.status !== 'error' &&
        containers.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No spaces</p>
            <p className={styles.emptyBody}>
              Create one to start collecting Threads
            </p>
          </div>
        ) : null}
      </section>

      <CreateContainerDialog
        onClose={() => setCreateOpen(false)}
        onCreate={createContainer}
        open={isCreateOpen}
        reservedIds={reservedIds}
      />
    </div>
  );
}
