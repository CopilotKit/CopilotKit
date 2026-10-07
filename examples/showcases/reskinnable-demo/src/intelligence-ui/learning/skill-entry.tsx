import { forwardRef } from "react";
import type { ReactNode } from "react";
import { ChevronRight, FileCode2 } from "lucide-react";
import styles from "./skill-entry.module.css";

/**
 * Renders the bordered card that holds Skill rows with dividers between them.
 *
 * @param props - Optional accessible name and the rows.
 * @returns The Skill row list.
 */
export function SkillEntryList(props: {
  readonly "aria-label"?: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <ul aria-label={props["aria-label"]} className={styles.list}>
      {props.children}
    </ul>
  );
}

export interface SkillEntryProps {
  /** Lifecycle hook for styling, e.g. `retired`. */
  readonly dataStatus?: string;
  /** Caption under the name, e.g. "Revision 1 · Published Sep 27". */
  readonly detail: ReactNode;
  readonly onClick: () => void;
  /** Status badge shown before the chevron. */
  readonly status: ReactNode;
  readonly title: string;
}

/**
 * One document row shared by Skill candidates and published Skills: icon
 * plate, name, caption, status badge, chevron. The whole row is the button.
 */
export const SkillEntry = forwardRef<HTMLButtonElement, SkillEntryProps>(
  function SkillEntry(props, ref) {
    return (
      <button
        className={styles.row}
        data-status={props.dataStatus}
        onClick={props.onClick}
        ref={ref}
        type="button"
      >
        <span aria-hidden="true" className={styles.mark}>
          <FileCode2 />
        </span>
        <span className={styles.text}>
          <strong>{props.title}</strong>
          <small>{props.detail}</small>
        </span>
        <span className={styles.status}>{props.status}</span>
        <ChevronRight aria-hidden="true" className={styles.chevron} />
      </button>
    );
  },
);
