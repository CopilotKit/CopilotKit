import {
  createElement,
  useId,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../primitives/class-name';
import styles from './layout.module.css';

export type LayoutGap = 'lg' | 'md' | 'none' | 'sm' | 'xl' | 'xs';
export type LayoutAlign = 'center' | 'end' | 'start' | 'stretch';
export type LayoutElement =
  | 'article'
  | 'aside'
  | 'div'
  | 'footer'
  | 'header'
  | 'main'
  | 'nav'
  | 'ol'
  | 'section'
  | 'ul';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly description?: ReactNode;
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6;
  readonly title?: ReactNode;
}

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: string;
}

export interface FlexibleLayoutProps extends HTMLAttributes<HTMLElement> {
  readonly align?: LayoutAlign;
  readonly as?: LayoutElement;
  readonly gap?: LayoutGap;
  readonly label?: string;
}

export interface SeparatorProps extends HTMLAttributes<HTMLHRElement> {
  readonly orientation?: 'horizontal' | 'vertical';
}

/**
 * Groups related content in a named section when a title is provided.
 */
export function Panel({
  children,
  className,
  description,
  headingLevel = 2,
  title,
  ...props
}: PanelProps): ReactNode {
  const generatedTitleId = useId();
  const titleId =
    props['aria-labelledby'] ?? (title ? generatedTitleId : undefined);
  const headingTag = `h${headingLevel}`;

  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.panel, className)}
      {...props}
    >
      {title ? (
        <header className={styles.panelHeader}>
          {createElement(
            headingTag,
            { className: styles.panelTitle, id: titleId },
            title,
          )}
          {description ? (
            <p className={styles.panelDescription}>{description}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Renders a named native toolbar for compact page or panel controls.
 */
export function Toolbar({
  children,
  className,
  label,
  ...props
}: ToolbarProps): ReactNode {
  return (
    <div
      aria-label={label}
      className={cx(styles.toolbar, className)}
      role="toolbar"
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Renders vertical rhythm for related content without changing chosen semantics.
 */
export function Stack({
  align,
  as = 'div',
  children,
  className,
  gap = 'md',
  label,
  ...props
}: FlexibleLayoutProps): ReactNode {
  return createElement(
    as,
    {
      'aria-label': label,
      className: cx(styles.stack, className),
      'data-align': align,
      'data-gap': gap,
      role: label ? 'group' : props.role,
      ...props,
    },
    children,
  );
}

/**
 * Renders a single-line inline layout for short metadata or control rows.
 */
export function Inline({
  align = 'center',
  as = 'div',
  children,
  className,
  gap = 'sm',
  label,
  ...props
}: FlexibleLayoutProps): ReactNode {
  return createElement(
    as,
    {
      'aria-label': label,
      className: cx(styles.inline, className),
      'data-align': align,
      'data-gap': gap,
      role: label ? 'group' : props.role,
      ...props,
    },
    children,
  );
}

/**
 * Renders a wrapping inline layout for command clusters and responsive chips.
 */
export function Cluster({
  align = 'center',
  as = 'div',
  children,
  className,
  gap = 'sm',
  label,
  ...props
}: FlexibleLayoutProps): ReactNode {
  return createElement(
    as,
    {
      'aria-label': label,
      className: cx(styles.cluster, className),
      'data-align': align,
      'data-gap': gap,
      role: label ? 'group' : props.role,
      ...props,
    },
    children,
  );
}

/**
 * Renders a semantic separator with explicit orientation state.
 */
export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: SeparatorProps): ReactNode {
  return (
    <hr
      aria-orientation={orientation}
      className={cx(styles.separator, className)}
      data-orientation={orientation}
      {...props}
    />
  );
}
