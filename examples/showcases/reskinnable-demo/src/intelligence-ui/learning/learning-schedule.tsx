/*
 * Demo stand-in for Intelligence apps/app-frontend/react-shell/src/learning/learning-schedule.tsx
 * (main @ b71006350). Same markup and styles for each presentation, over a fixed
 * project schedule (daily at 2:00 AM, the organization default) instead of the
 * schedule API; the editor dialog is left out.
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { Badge } from '../ui/feedback';
import { Button } from '../ui/primitives';
import styles from './learning-automation.module.css';

const LOCAL_TIME = '2:00 AM';

/** The next 2:00 AM in this browser's zone. */
function nextRunAt(now: number): string {
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function nextCheckLabel(next: string, now: number): string {
  const difference = Date.parse(next) - now;
  if (difference <= 0) return 'Check due';
  if (difference < 60_000) return '<1m';
  const minutes = Math.ceil(difference / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  return `${minutes}m`;
}

function zoneLabel(timeZone: string, at: string): string {
  const abbreviation = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: 'short',
  })
    .formatToParts(new Date(at))
    .find((part) => part.type === 'timeZoneName')?.value;
  const city = timeZone.split('/').at(-1)?.replaceAll('_', ' ') ?? timeZone;
  return abbreviation === city ? city : `${city} (${abbreviation})`;
}

export function LearningSchedule(props: {
  readonly apiClient?: unknown;
  readonly projectId: number;
  readonly manualAction?: ReactNode;
  readonly renderReadiness?: (nextScheduledRun: ReactNode) => ReactNode;
  readonly presentation?: 'summary' | 'trigger' | 'embedded' | 'readiness';
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const at = nextRunAt(now);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const nextScheduledRun = (
    <div className={styles.nextRun}>
      <div className={styles.nextCheck}>
        <span className={styles.scheduleLabel}>Next scheduled run</span>
        <strong>{nextCheckLabel(at, now)}</strong>
      </div>
      <p className={styles.scheduleTimes}>
        <time dateTime={at}>
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(at))}{' '}
          {zoneLabel(zone, at)}
          {' ('}
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'UTC',
          }).format(new Date(at))}{' '}
          UTC)
        </time>
      </p>
    </div>
  );

  if (props.presentation === 'readiness') {
    return <>{props.renderReadiness?.(nextScheduledRun)}</>;
  }

  if (props.presentation === 'trigger') {
    return (
      <Button variant="outline">
        <Clock aria-hidden="true" size={15} />
        Schedule
      </Button>
    );
  }

  return (
    <section
      className={styles.projectSchedule}
      data-presentation={props.presentation}
      aria-label="Project learning schedule"
    >
      <div className={styles.scheduleSummary}>
        <span aria-hidden="true" className={styles.scheduleMark}>
          <Clock />
        </span>
        <div className={styles.scheduleDetails}>
          <div className={styles.recurrenceLine}>
            <p className={styles.scheduleRecurrence}>
              <span>Daily at {LOCAL_TIME}</span> {zoneLabel(zone, at)}
            </p>
          </div>
        </div>
        <Badge>Uses organization schedule</Badge>
      </div>
      <div className={styles.scheduleControls}>
        <Button aria-label="Edit schedule for project" size="sm" variant="outline">
          Edit schedule
        </Button>
        {props.manualAction ? (
          <div className={styles.scheduleManualAction}>{props.manualAction}</div>
        ) : null}
      </div>
    </section>
  );
}
