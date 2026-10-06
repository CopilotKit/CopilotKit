import { useId, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../primitives/class-name';
import styles from './feedback.module.css';

export type FeedbackVariant = 'danger' | 'info' | 'success' | 'warning';
export type BadgeVariant =
  | 'accent'
  | 'danger'
  | 'neutral'
  | 'outline'
  | 'sidebar'
  | 'success'
  | 'warning';

export interface BadgeProps {
  readonly children: ReactNode;
  readonly className?: string;
  /** Leading status dot for lifecycle/health states; omit for categories. */
  readonly dot?: boolean;
  /** `sm` is the compact tag for dense rows such as the account trigger. */
  readonly size?: 'md' | 'sm';
  readonly variant?: BadgeVariant;
}

export interface AlertProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly title: ReactNode;
  readonly variant?: FeedbackVariant;
}

export interface StatusMessageProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly title: ReactNode;
  readonly variant?: FeedbackVariant;
}

export interface SpinnerProps {
  readonly className?: string;
  readonly label: string;
}

export interface LoadingPageProps {
  readonly as?: 'div' | 'main' | 'section';
  readonly className?: string;
  readonly label: ReactNode;
}

export interface SkeletonProps {
  readonly className?: string;
  readonly label?: string;
  readonly style?: CSSProperties;
}

export interface EmptyStateProps {
  readonly action?: ReactNode;
  readonly className?: string;
  readonly description?: ReactNode;
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Decorative mark; the title and description carry the meaning. */
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  /** Workspace-only layouts. The default keeps legacy consumers unchanged. */
  readonly variant?: 'embedded' | 'collection';
}

/**
 * Renders compact, text-backed state metadata.
 */
export function Badge({
  children,
  className,
  dot = false,
  size = 'md',
  variant = 'neutral',
}: BadgeProps): ReactNode {
  return (
    <span
      className={cx(styles.badge, className)}
      data-size={size}
      data-slot="badge"
      data-variant={variant}
    >
      {dot ? <span aria-hidden="true" className={styles.badgeDot} /> : null}
      {children}
    </span>
  );
}

/**
 * Renders a named alert or status block for important feedback.
 */
export function Alert({
  children,
  className,
  title,
  variant = 'info',
}: AlertProps): ReactNode {
  const titleId = useId();
  const role = variant === 'danger' ? 'alert' : 'status';

  return (
    <div
      aria-labelledby={titleId}
      className={cx(styles.alert, className)}
      data-variant={variant}
      role={role}
    >
      <p className={styles.alertTitle} id={titleId}>
        {title}
      </p>
      {children ? <p className={styles.alertBody}>{children}</p> : null}
    </div>
  );
}

/**
 * Renders inline workflow feedback with status or alert semantics.
 */
export function StatusMessage({
  children,
  className,
  title,
  variant = 'info',
}: StatusMessageProps): ReactNode {
  const titleId = useId();
  const role = variant === 'danger' ? 'alert' : 'status';

  return (
    <div
      aria-labelledby={titleId}
      className={cx(styles.statusMessage, className)}
      data-variant={variant}
      role={role}
    >
      <p className={styles.statusTitle} id={titleId}>
        {title}
      </p>
      {children ? <p className={styles.statusBody}>{children}</p> : null}
    </div>
  );
}

/**
 * Renders a reduced-motion-safe loading spinner with a stable accessible label.
 */
export function Spinner({ className, label }: SpinnerProps): ReactNode {
  return (
    <span
      aria-label={label}
      aria-live="polite"
      className={cx(styles.spinner, className)}
      role="status"
    >
      <svg
        aria-hidden="true"
        className={styles.spinnerMark}
        focusable="false"
        viewBox="0 0 24 24"
      >
        <circle className={styles.spinnerCircle} cx="12" cy="12" r="9" />
        <path className={styles.spinnerArc} d="M21 12a9 9 0 0 0-9-9" />
      </svg>
    </span>
  );
}

/**
 * Renders a full-surface loading bridge with centered progress and concise text.
 */
export function LoadingPage({
  as: Component = 'main',
  className,
  label,
}: LoadingPageProps): ReactNode {
  const labelId = useId();

  return (
    <Component className={cx(styles.loadingPage, className)}>
      <div
        aria-labelledby={labelId}
        className={styles.loadingPageState}
        role="status"
      >
        <span className={styles.loadingPageSpinner} aria-hidden="true" />
        <p className={styles.loadingPageText} id={labelId}>
          {label}
        </p>
      </div>
    </Component>
  );
}

/**
 * Renders a placeholder block that is decorative unless labelled as loading state.
 */
export function Skeleton({
  className,
  label,
  style,
}: SkeletonProps): ReactNode {
  if (label) {
    return (
      <span
        aria-busy="true"
        aria-label={label}
        className={cx(styles.skeleton, className)}
        role="status"
        style={style}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, className)}
      style={style}
    />
  );
}

/**
 * Renders a concise empty state with an optional primary recovery action.
 */
export function EmptyState({
  action,
  className,
  description,
  headingLevel = 2,
  icon,
  title,
  variant,
}: EmptyStateProps): ReactNode {
  const Heading = `h${headingLevel}` as const;
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.emptyState, className)}
      data-has-icon={icon ? 'true' : undefined}
      data-variant={variant}
    >
      {icon ? (
        <span aria-hidden="true" className={styles.emptyIcon}>
          {icon}
        </span>
      ) : null}
      <div className={styles.emptyContent}>
        <Heading className={styles.emptyTitle} id={titleId}>
          {title}
        </Heading>
        {description ? (
          <p className={styles.emptyDescription}>{description}</p>
        ) : null}
        {action ? <div className={styles.emptyAction}>{action}</div> : null}
      </div>
    </section>
  );
}
