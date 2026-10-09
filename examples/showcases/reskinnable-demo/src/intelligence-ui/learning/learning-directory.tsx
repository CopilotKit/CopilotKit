/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { motion } from 'motion/react';
import { useWorkspaceEntranceMotion } from '../shell/workspace-entrance';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from '../shell/router';
import { ArrowRight, Layers, Plus } from 'lucide-react';
import { CollectionPagination } from '../ui/data-display';
import { EmptyState } from '../ui/feedback';
import { MenuRadioGroup, MenuRadioItem } from '../ui/overlays';
import { Button } from '../ui/primitives';

import { useCollectionPage } from '../shell/workspace-collection-page';
import { WorkspaceCollectionToolbar } from '../shell/workspace-collection-toolbar';
import { WorkspacePageHeader } from '../shell/workspace-page-header';
import { LearningNotice } from './learning-notice';
import { LearningSpaceList, spaceKey } from './learning-space-list';
import type {
  LearningApi,
  LearningContainer,
  LearningContainerPage,
  LearningContainerStats,
} from './learning-api';
import { containerState } from './learning-container-state';
import { learningContainerRoute } from './learning-routes';
import styles from './learning-directory.module.css';

/**
 * Lists spaces from several projects (the All projects scope). Space IDs are
 * unique only within a project, so evidence and routes are resolved per row.
 */
export interface LearningDirectoryScope {
  /** The project a listed space belongs to, with its base route. */
  readonly projectOf: (
    space: LearningContainer,
  ) => { readonly name: string; readonly baseRoute: string } | undefined;
  /** Evidence for a listed space. */
  readonly statsOf: (
    space: LearningContainer,
  ) => LearningContainerStats | undefined;
  /** Extra filter-menu content, such as a Project filter. */
  readonly filterMenu?: ReactNode;
  /** Whether a space passes the extra filter. */
  readonly matches?: (space: LearningContainer) => boolean;
  /** Clears the extra filter with the directory's own filters. */
  readonly onClearFilters?: () => void;
  /** Caption under the header, such as coverage. */
  readonly note?: ReactNode;
}

/**
 * One project's spaces (with its API for more pages and its evidence), or
 * the spaces of several projects through `scope`.
 */
export type LearningDirectoryProps = {
  readonly baseRoute: string;
  readonly initialPage: LearningContainerPage;
  /**
   * Opens the create dialog with every space ID loaded so far, including
   * later pages, so the dialog can refuse a duplicate.
   */
  readonly onCreate: (loadedIds: readonly string[]) => void;
  readonly onRefresh: () => void;
  readonly schedule?: ReactNode;
} & (
  | {
      readonly api: LearningApi;
      readonly projectId: number;
      readonly stats: readonly LearningContainerStats[];
      /** Why the evidence read failed, or `null` when it did not. */
      readonly statsError?: string | null;
      /** Re-reads the evidence without reloading the listed spaces. */
      readonly onRetryStats?: () => void;
      readonly scope?: undefined;
    }
  | {
      readonly api?: undefined;
      readonly projectId?: undefined;
      readonly stats?: undefined;
      readonly statsError?: undefined;
      readonly onRetryStats?: undefined;
      readonly scope: LearningDirectoryScope;
    }
);

/**
 * Describes the space the directory prompts the reader to analyze next.
 *
 * @param count - New conversations waiting in the space.
 * @param place - The space name, with its project across projects.
 * @returns The prompt's description sentence.
 */
function readyDescription(count: number, place: string): string {
  return count === 1
    ? `1 new conversation in ${place} is ready to analyze.`
    : `${count} new conversations in ${place} are ready to analyze.`;
}

/** Shows real project Learning Spaces before opening one of their views. */
export function LearningDirectory(
  props: LearningDirectoryProps,
): React.JSX.Element {
  const entrance = useWorkspaceEntranceMotion(2);
  const toolbarEntrance = useWorkspaceEntranceMotion(1);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [extra, setExtra] = useState<readonly LearningContainer[]>([]);
  const [cursor, setCursor] = useState(props.initialPage.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestRef.current?.abort();
    setExtra([]);
    setCursor(props.initialPage.nextCursor);
    setMoreError(null);
    setLoadingMore(false);
    return () => requestRef.current?.abort();
  }, [props.initialPage]);

  const { scope } = props;
  const all = [...props.initialPage.containers, ...extra].filter(
    (item, index, rows) =>
      rows.findIndex((other) => spaceKey(other) === spaceKey(item)) === index &&
      (scope !== undefined || item.projectId === props.projectId),
  );
  const statsById = new Map(
    (props.stats ?? []).map((item) => [item.containerId, item]),
  );
  const statsOf = (
    item: LearningContainer,
  ): LearningContainerStats | undefined =>
    scope ? scope.statsOf(item) : statsById.get(item.id);
  // A space mid-analysis opens where that analysis reports its progress.
  const routeOf = (item: LearningContainer): string =>
    learningContainerRoute(
      scope?.projectOf(item)?.baseRoute ?? props.baseRoute,
      item.id,
      containerState(statsOf(item) ?? null) === 'analyzing'
        ? 'analysis-results'
        : 'insights',
    );
  const visible = all
    .filter((item) => {
      if (scope?.matches && !scope.matches(item)) return false;
      const projectName = scope?.projectOf(item)?.name ?? '';
      if (
        !`${item.name} ${projectName}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      )
        return false;
      const pending = statsOf(item)?.pendingThreadCount;
      return (
        filter === 'all' ||
        (pending !== undefined &&
          (filter === 'awaiting' ? pending > 0 : pending === 0))
      );
    })
    .sort((left, right) =>
      sort === 'name'
        ? left.name.localeCompare(right.name)
        : right.updatedAt.localeCompare(left.updatedAt) ||
          left.name.localeCompare(right.name),
    );
  // Across projects, prompt for the space with the most new conversations.
  const readySpace = scope
    ? all.reduce<LearningContainer | undefined>(
        (best, space) =>
          (statsOf(space)?.pendingThreadCount ?? 0) >
          (best ? (statsOf(best)?.pendingThreadCount ?? 0) : 0)
            ? space
            : best,
        undefined,
      )
    : all.find(
        (space) => (statsById.get(space.id)?.pendingThreadCount ?? 0) > 0,
      );
  const readyProject = readySpace ? scope?.projectOf(readySpace) : undefined;
  const { changePage, hrefForPage, page } = useCollectionPage(
    visible.length,
    10,
  );
  /** Returns to the first page after a search, filter, or sort change. */
  const resetPage = (): void => changePage(1);

  /** Adds one server page without implying a known total. */
  const loadMore = async (): Promise<void> => {
    // Only one project's directory pages; a scoped list arrives complete.
    if (cursor === null || loadingMore || props.api === undefined) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await props.api.listContainers(
        props.projectId,
        { signal: controller.signal },
        cursor,
      );
      if (controller.signal.aborted) return;
      if (next.nextCursor !== null && next.nextCursor === cursor)
        throw new Error('The next page repeated its cursor.');
      setExtra((current) => [...current, ...next.containers]);
      setCursor(next.nextCursor);
    } catch (error) {
      if (!controller.signal.aborted)
        setMoreError(
          error instanceof Error
            ? error.message
            : 'More Learning Spaces could not be loaded.',
        );
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  };

  return (
    <section className={styles.page} aria-labelledby="learning-directory-title">
      <WorkspacePageHeader
        actions={
          <>
            {props.schedule}
            <Button
              onClick={() => props.onCreate(all.map((space) => space.id))}
              variant="primary"
            >
              <Plus aria-hidden="true" size={15} />
              Create learning space
            </Button>
          </>
        }
        description="Find patterns in your conversations. Inspect the skills they produce."
        title="Automatic learning"
        titleId="learning-directory-title"
      />
      {scope?.note}
      {props.statsError ? (
        <div className={styles.nextStep} role="alert">
          <LearningNotice
            action={
              <Button onClick={props.onRetryStats} size="sm" variant="outline">
                Retry
              </Button>
            }
            description={props.statsError}
            title="Could not load Thread counts"
          />
        </div>
      ) : readySpace ? (
        <motion.div {...toolbarEntrance}>
          <LearningNotice
            action={
              <Button asChild size="sm" variant="outline">
                <Link to={routeOf(readySpace)}>
                  Open learning space
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </Button>
            }
            aria-label="Ready to learn"
            className={styles.nextStep}
            description={readyDescription(
              statsOf(readySpace)?.pendingThreadCount ?? 0,
              `${readySpace.name}${readyProject ? ` (${readyProject.name})` : ''}`,
            )}
            headingLevel={2}
            title="Find what your agent can do better"
            tone="learning"
          />
        </motion.div>
      ) : null}
      <h2 className={styles.sectionTitle}>Learning spaces</h2>
      <div className={styles.toolbar}>
        <WorkspaceCollectionToolbar
          filter={
            <>
              <MenuRadioGroup
                value={filter}
                onValueChange={(value) => {
                  setFilter(value);
                  resetPage();
                }}
              >
                <MenuRadioItem value="all">All spaces</MenuRadioItem>
                <MenuRadioItem value="awaiting">Has new Threads</MenuRadioItem>
                <MenuRadioItem value="current">Up to date</MenuRadioItem>
              </MenuRadioGroup>
              {scope?.filterMenu}
            </>
          }
          label="Learning Spaces"
          onQueryChange={(next) => {
            setQuery(next);
            resetPage();
          }}
          onRefresh={props.onRefresh}
          query={query}
          searchInputRef={searchRef}
          sort={
            <MenuRadioGroup
              value={sort}
              onValueChange={(value) => {
                setSort(value);
                resetPage();
              }}
            >
              <MenuRadioItem value="recent">Recently updated</MenuRadioItem>
              <MenuRadioItem value="name">Name A–Z</MenuRadioItem>
            </MenuRadioGroup>
          }
        />
      </div>
      <motion.div
        {...entrance}
        className={`${styles.results} ${visible.length === 0 ? styles.resultsEmpty : ''}`}
        data-columns={scope ? 'project' : undefined}
      >
        {visible.length > 0 ? (
          <LearningSpaceList
            projectOf={scope?.projectOf}
            routeOf={routeOf}
            spaces={visible.slice((page - 1) * 10, page * 10)}
            statsOf={statsOf}
          />
        ) : (
          <EmptyState
            action={
              <Button
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                  scope?.onClearFilters?.();
                  resetPage();
                  searchRef.current?.focus();
                }}
                variant="outline"
              >
                Clear filters
              </Button>
            }
            description={
              scope
                ? 'Try another name, or change the status or project filter.'
                : 'Try another name or change the status filter.'
            }
            headingLevel={3}
            icon={<Layers />}
            title="No matching Learning Spaces"
            variant="collection"
          />
        )}
      </motion.div>
      {visible.length > 0 ? (
        <CollectionPagination
          hrefForPage={hrefForPage}
          label="Learning Spaces"
          onPageChange={changePage}
          page={page}
          pageSize={10}
          total={visible.length}
        />
      ) : null}
      {moreError ? (
        <p role="alert">
          {moreError}{' '}
          <Button onClick={loadMore} size="sm" variant="outline">
            Retry
          </Button>
        </p>
      ) : cursor !== null ? (
        <Button disabled={loadingMore} onClick={loadMore} variant="outline">
          {loadingMore ? 'Loading more…' : 'Load more Learning Spaces'}
        </Button>
      ) : null}
      <p className="cpki-visually-hidden" role="status">
        Showing {visible.length} loaded Learning Spaces
        {cursor !== null ? '; more may be available' : ''}.
      </p>
    </section>
  );
}
