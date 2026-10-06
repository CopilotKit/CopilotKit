import type { ReactNode } from 'react';
import styles from './learning-notice.module.css';

/** Shared class names for notices whose parts live in other components. */
export const learningNoticeStyles = styles;

/**
 * Renders the compact Learning notice: title and description on the left,
 * an optional action on the right.
 *
 * @param props - Notice copy, tone, accessible name, and the optional action.
 * @returns The notice section.
 */
export function LearningNotice(props: {
  readonly action?: ReactNode;
  readonly 'aria-label'?: string;
  readonly className?: string;
  readonly description?: ReactNode;
  readonly headingLevel?: 2 | 3;
  readonly title: ReactNode;
  readonly tone?: 'learning' | 'muted';
}): React.JSX.Element {
  const Title = props.headingLevel ? (`h${props.headingLevel}` as const) : 'p';
  return (
    <section
      aria-label={props['aria-label']}
      className={[styles.notice, props.className].filter(Boolean).join(' ')}
      data-tone={props.tone ?? 'muted'}
    >
      <div className={styles.text}>
        <Title className={styles.title}>{props.title}</Title>
        {props.description ? (
          <p className={styles.description}>{props.description}</p>
        ) : null}
      </div>
      {props.action ? <div className={styles.aside}>{props.action}</div> : null}
    </section>
  );
}
