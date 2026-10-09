import { IconButton } from '../ui/primitives';
import { Link } from '../shell/router';

import type { LearningInsightEvidence } from './learning-api';
import styles from './learning-drawers.module.css';

/** Renders a directional chevron for the evidence pager. */
function ChevronIcon(props: {
  readonly direction: 'next' | 'previous';
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <path
        d={props.direction === 'next' ? 'm10 6 6 6-6 6' : 'm14 6-6 6 6 6'}
      />
    </svg>
  );
}

/**
 * Explains a citation that cannot be quoted, without denying it happened.
 *
 * @param entry - One cited Thread whose messages resolved to nothing.
 * @returns Copy naming how many messages were cited and why they are not shown.
 */
function evidenceGapCopy(entry: LearningInsightEvidence): string {
  const cited = `${entry.messageCount} cited ${entry.messageCount === 1 ? 'message' : 'messages'}`;
  if (entry.unavailable === 'snapshot-missing') {
    return `${cited}. The frozen transcript for this analysis is no longer stored, so the text cannot be shown.`;
  }
  if (entry.unavailable === 'snapshot-unreadable') {
    return `${cited}. The frozen transcript could not be read, so the text cannot be shown.`;
  }
  return `${cited}. None of them resolved inside the frozen transcript for this analysis.`;
}

/**
 * Renders one evidence entry as a source Thread card.
 *
 * Quotes the frozen messages resolved by the evidence API and links to the
 * current Thread only while it remains in the project.
 */
export function EvidenceBrowser(props: {
  readonly baseRoute: string;
  readonly evidence: readonly LearningInsightEvidence[];
  readonly index: number;
  readonly onSelect: (index: number) => void;
  readonly state: 'error' | 'loading' | 'ready';
}): React.JSX.Element {
  const total = props.evidence.length;

  if (props.state === 'loading') {
    return (
      <p className={styles.evidenceEmpty} role="status">
        Loading the cited messages…
      </p>
    );
  }

  if (props.state === 'error') {
    return (
      <p className={styles.evidenceEmpty} role="alert">
        The cited messages could not be read. The Insight still cites its
        Threads; only the quoted text is missing.
      </p>
    );
  }

  if (total === 0) {
    return (
      <p className={styles.evidenceEmpty}>
        This Insight cites no Threads. Nothing was recorded to browse, so there
        is no source to open.
      </p>
    );
  }

  const entry = props.evidence[props.index];
  const threadLabel = entry.threadName ?? entry.threadId;

  return (
    <>
      <div className={styles.evidenceBrowser}>
        <div className={styles.evidenceHead}>
          <span>{`Evidence ${props.index + 1} of ${total}`}</span>
          {total > 1 ? (
            <div className={styles.evidenceNav}>
              <IconButton
                disabled={props.index === 0}
                label="Previous evidence"
                onClick={() => props.onSelect(props.index - 1)}
                size="sm"
                variant="ghost"
              >
                <ChevronIcon direction="previous" />
              </IconButton>
              <IconButton
                disabled={props.index === total - 1}
                label="Next evidence"
                onClick={() => props.onSelect(props.index + 1)}
                size="sm"
                variant="ghost"
              >
                <ChevronIcon direction="next" />
              </IconButton>
            </div>
          ) : null}
        </div>
        <div aria-live="polite" className={styles.evidenceQuotes}>
          {entry.cited.length === 0 ? (
            <p className={styles.evidenceMessageCount}>
              {evidenceGapCopy(entry)}
            </p>
          ) : (
            entry.cited.map((message) => (
              <blockquote
                className={styles.evidenceQuote}
                data-role={message.role}
                key={message.id}
              >
                <span className={styles.evidenceRole}>
                  {message.role.charAt(0).toUpperCase() + message.role.slice(1)}
                </span>
                <p>{message.content}</p>
              </blockquote>
            ))
          )}
        </div>
        <div className={styles.evidenceFoot}>
          <div className={styles.evidenceSource}>
            <span className={styles.evidenceSourceLabel}>Source trajectory</span>
            <span className={styles.evidenceSourceName}>{threadLabel}</span>
          </div>
          {/* An Insight outlives the Threads it cites, and a link to one that
              has been deleted is worse than no link. */}
          {entry.threadPresent ? (
            <Link
              aria-label={`Open trajectory ${threadLabel}`}
              className={styles.evidenceLink}
              to={`${props.baseRoute}/threads/${encodeURIComponent(entry.threadId)}`}
            >
              Open trajectory
            </Link>
          ) : null}
        </div>
      </div>
      {total > 1 ? (
        <div
          aria-label="Evidence entries"
          className={styles.evidenceDots}
          role="group"
        >
          {props.evidence.map((reference, index) => (
            <button
              aria-current={index === props.index ? 'true' : undefined}
              aria-label={`Evidence ${index + 1}`}
              className={styles.evidenceDot}
              key={`${reference.threadId}:${index}`}
              onClick={() => props.onSelect(index)}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
