import type { ReactNode } from 'react';

export interface WorkspacePageHeaderProps {
  /** Heading level for standalone pages or nested workspace sections. */
  readonly headingLevel?: 1 | 2;
  /** Optional controls aligned with the page identity. */
  readonly actions?: ReactNode;
  /** Stable explanation shown in every page state. */
  readonly description: string;
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
 * @param props - Stable page identity and optional actions.
 * @returns The project-page header.
 */
export function WorkspacePageHeader(
  props: WorkspacePageHeaderProps,
): React.JSX.Element {
  const Heading = props.headingLevel === 1 ? 'h1' : 'h2';
  return (
    <header className="shell-page__header managed-page-header">
      <div className="shell-page__heading">
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
      </div>
      {props.actions ? (
        <div className="managed-page-header__actions">{props.actions}</div>
      ) : null}
    </header>
  );
}
