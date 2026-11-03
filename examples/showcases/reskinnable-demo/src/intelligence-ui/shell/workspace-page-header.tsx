import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "./router";
import { useWorkspaceEntranceMotion } from "./workspace-entrance";
import styles from "./workspace-page-header.module.css";

/** Parent collection link shown above a detail page title. */
export interface WorkspacePageBackLink {
  readonly label: string;
  readonly to: string;
}

export interface WorkspacePageHeaderProps {
  /** Defaults to the page heading; use 2 only inside an existing page. */
  readonly headingLevel?: 1 | 2;
  /** Optional controls aligned with the page identity. */
  readonly actions?: ReactNode;
  /** Parent collection for detail pages, e.g. `Channels` above one channel. */
  readonly backLink?: WorkspacePageBackLink;
  /** Stable explanation shown in every page state. */
  readonly description: ReactNode;
  /** Caption under the header, such as All projects coverage. */
  readonly note?: string;
  /** Visible page name. */
  readonly title: string;
  /** Optional status displayed beside the title. */
  readonly titleBadge?: ReactNode;
  /** ID used by the page region's accessible label. */
  readonly titleId: string;
}

/**
 * Renders the shared title, description, and actions for a project page.
 *
 * @param props - Stable page identity, optional actions, and an optional note.
 * @returns The project-page header, then its note.
 */
export function WorkspacePageHeader(
  props: WorkspacePageHeaderProps,
): React.JSX.Element {
  const Heading = props.headingLevel === 2 ? "h2" : "h1";
  const entrance = useWorkspaceEntranceMotion();
  const header = (
    <header className="shell-page__header managed-page-header">
      <motion.div className="shell-page__heading" {...entrance}>
        {props.backLink ? (
          <Link className="shell-page__back" to={props.backLink.to}>
            <ArrowLeft aria-hidden="true" size={13} />
            {props.backLink.label}
          </Link>
        ) : null}
        <div className="shell-page__title-row">
          <Heading
            className="shell-page__title"
            id={props.titleId}
            tabIndex={-1}
          >
            {props.title}
          </Heading>
          {props.titleBadge ?? null}
        </div>
        <p className="shell-page__copy">{props.description}</p>
      </motion.div>
      {props.actions ? (
        <div className="managed-page-header__actions">{props.actions}</div>
      ) : null}
    </header>
  );
  return props.note === undefined ? (
    header
  ) : (
    <>
      {header}
      <p className={styles.note}>{props.note}</p>
    </>
  );
}
