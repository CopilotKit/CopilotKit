import type { ReactNode } from "react";
import { Link } from "../shell/router";
import { FormattedDateTime } from "../ui/datetime";
import { ChevronRight, Layers, MessagesSquare } from "lucide-react";
import styles from "./finding-list.module.css";

/**
 * Renders the divider-row list shared by Learning Insights and Product Insights.
 *
 * The list draws row dividers only; pass `bordered` when the list is the whole
 * card, or place it inside a caller-owned frame (for example a scroll region).
 *
 * @param props - Accessible list name, rows, and whether the list draws its own card.
 * @returns The finding list.
 */
export function FindingList(props: {
  readonly "aria-label": string;
  readonly bordered?: boolean;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <ul
      aria-label={props["aria-label"]}
      className={styles.list}
      data-bordered={props.bordered || undefined}
    >
      {props.children}
    </ul>
  );
}

/**
 * Renders one finding row, the same in Learning Insights and Product Insights:
 * a chip line (the source Learning Space and/or a status badge), the title and
 * description, a caption meta line, and a chevron.
 *
 * The title button stretches over the whole row, so the row opens on click
 * while the source link and any meta buttons stay independently reachable.
 *
 * @param props - Row copy, its open action, and optional source, meta, and status.
 * @returns One list item.
 */
export function FindingRow(props: {
  readonly description: string;
  readonly meta?: ReactNode;
  readonly onOpen: (opener: HTMLButtonElement) => void;
  readonly source?: { readonly label: string; readonly to: string };
  /** Badge shown in the chip line, where Product Insights shows its source. */
  readonly status?: ReactNode;
  readonly title: string;
}): React.JSX.Element {
  return (
    <li className={styles.row}>
      <div className={styles.body}>
        {props.source || props.status ? (
          <div className={styles.chips}>
            {props.source ? (
              <Link className={styles.source} to={props.source.to}>
                <Layers aria-hidden="true" />
                {props.source.label}
              </Link>
            ) : null}
            {props.status ? (
              <span className={styles.status}>{props.status}</span>
            ) : null}
          </div>
        ) : null}
        <button
          className={styles.title}
          onClick={(event) => props.onOpen(event.currentTarget)}
          type="button"
        >
          <strong>{props.title}</strong>
          <span>{props.description}</span>
        </button>
        {props.meta ? <div className={styles.meta}>{props.meta}</div> : null}
      </div>
      <ChevronRight aria-hidden="true" className={styles.chevron} />
    </li>
  );
}

/**
 * Renders the cited-thread count in a finding's meta line.
 *
 * With `onClick` the count is its own evidence button (named by `ariaLabel`);
 * without it the count is plain caption text. Both read the same visually.
 *
 * @param props - Visible count label and the optional evidence action.
 * @returns The evidence caption.
 */
export function FindingEvidence(props: {
  readonly ariaLabel?: string;
  readonly label: string;
  readonly onClick?: () => void;
}): React.JSX.Element {
  const content = (
    <>
      <MessagesSquare aria-hidden="true" />
      {props.label}
    </>
  );
  return props.onClick ? (
    <button
      aria-label={props.ariaLabel}
      className={styles.evidence}
      onClick={props.onClick}
      type="button"
    >
      {content}
    </button>
  ) : (
    <span className={styles.evidence}>{content}</span>
  );
}

/**
 * Renders a finding's creation date in the meta line, in the one date format
 * both Insight lists use.
 *
 * @param props - ISO timestamp of the finding.
 * @returns A `time` element with the formatted date.
 */
export function FindingDate(props: {
  readonly value: string;
}): React.JSX.Element {
  return (
    <time dateTime={props.value}>
      <FormattedDateTime
        invalidFallback="Date unavailable"
        value={props.value}
        variant="date"
      />
    </time>
  );
}

/**
 * Formats a cited-thread count in the shared sentence-case form.
 *
 * @param count - Distinct Threads cited by one finding.
 * @returns For example "1 cited thread" or "3 cited threads".
 */
export function citedThreadsLabel(count: number): string {
  return `${count} cited ${count === 1 ? "thread" : "threads"}`;
}

/**
 * Formats a cited-message count in the shared sentence-case form.
 *
 * @param count - Cited messages across every Thread of one finding.
 * @returns For example "1 reference" or "3 references".
 */
export function referencesLabel(count: number): string {
  return `${count} ${count === 1 ? "reference" : "references"}`;
}
