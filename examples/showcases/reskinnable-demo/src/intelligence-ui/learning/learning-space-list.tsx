import { Link } from '../shell/router';
import { Badge } from '../ui/feedback';
import { FormattedDateTime } from '../ui/datetime';

import type { LearningContainer, LearningContainerStats } from './learning-api';
import styles from './learning-directory.module.css';

/**
 * Identifies a listed space; IDs repeat across projects.
 *
 * @param space - A Learning Space.
 * @returns A key unique across projects.
 */
export function spaceKey(space: LearningContainer): string {
  return `${space.projectId}/${space.id}`;
}

/**
 * Says how many earlier runs of a space are lost because their events are
 * gone, so a short history is not mistaken for a complete one.
 *
 * @param count - Runs the stats report as unrecoverable; at least one.
 * @returns The note shown under the space's last analysis.
 */
function unrecoverableRunsNote(count: number): string {
  return count === 1
    ? '1 earlier run could not be recovered because its events are unavailable.'
    : `${count.toLocaleString()} earlier runs could not be recovered because their events are unavailable.`;
}

/**
 * Lists Learning Spaces as the directory's link rows: name and ID, Threads,
 * new Threads, and last analysis, with a Project column across projects.
 *
 * @param props - The spaces to list, their evidence and routes, and the
 * project of each space when the list spans projects.
 * @returns The column heading and the list of space rows.
 */
export function LearningSpaceList(props: {
  readonly spaces: readonly LearningContainer[];
  readonly statsOf: (
    space: LearningContainer,
  ) => LearningContainerStats | undefined;
  readonly routeOf: (space: LearningContainer) => string;
  readonly projectOf?: (
    space: LearningContainer,
  ) => { readonly name: string } | undefined;
}): React.JSX.Element {
  const { projectOf } = props;
  return (
    <>
      <div aria-hidden="true" className={styles.columnHead}>
        <span>Space</span>
        {projectOf ? <span>Project</span> : null}
        <span>Threads</span>
        <span>New Threads</span>
        <span>Last analysis</span>
      </div>
      <ul aria-label="Learning Spaces" className={styles.list}>
        {props.spaces.map((item) => {
          const progress = props.statsOf(item);
          return (
            <li key={spaceKey(item)}>
              <Link className={styles.row} to={props.routeOf(item)}>
                <span className={styles.name}>
                  <strong>{item.name}</strong>
                  <small>{item.id}</small>
                </span>
                {projectOf ? (
                  <span className={styles.project}>
                    {projectOf(item)?.name ?? '—'}
                  </span>
                ) : null}
                <span>
                  {progress?.threadCount ?? '—'}
                  {progress?.threadCount === 1 ? ' Thread' : ' Threads'}
                </span>
                <span>
                  {progress === undefined ? (
                    'Evidence unknown'
                  ) : progress.pendingThreadCount > 0 ? (
                    <Badge variant="accent">
                      {progress.pendingThreadCount} awaiting analysis
                    </Badge>
                  ) : (
                    'Up to date'
                  )}
                </span>
                <span>
                  {progress?.lastSucceededAt ? (
                    <FormattedDateTime
                      value={progress.lastSucceededAt}
                      invalidFallback="Date unavailable"
                      variant="date"
                    />
                  ) : (
                    'Never analyzed'
                  )}
                  {progress?.unrecoverableRunCount ? (
                    <small className={styles.history}>
                      {unrecoverableRunsNote(progress.unrecoverableRunCount)}
                    </small>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
