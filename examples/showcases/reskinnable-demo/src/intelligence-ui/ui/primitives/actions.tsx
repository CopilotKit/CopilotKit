import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';
import { forwardRef } from 'react';
import styles from './actions.module.css';
import { cx } from './class-name';

export type ActionVariant = 'danger' | 'ghost' | 'primary' | 'secondary';
export type ActionSize = 'lg' | 'md' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly size?: ActionSize;
  readonly variant?: ActionVariant;
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  readonly label: string;
  readonly size?: ActionSize;
  readonly variant?: ActionVariant;
}

export interface LinkButtonProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly size?: ActionSize;
  readonly variant?: ActionVariant;
}

export interface ButtonGroupProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly label: string;
}

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Renders the default action control with native button semantics.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      size = 'md',
      type = 'button',
      variant = 'secondary',
      ...props
    },
    ref,
  ): ReactNode {
    return (
      <button
        className={cx(styles.button, className)}
        data-size={size}
        data-variant={variant}
        ref={ref}
        type={type}
        {...props}
      />
    );
  },
);

/**
 * Renders a compact icon-only button with a required accessible label.
 */
export function IconButton({
  className,
  label,
  size = 'md',
  type = 'button',
  variant = 'secondary',
  ...props
}: IconButtonProps): ReactNode {
  return (
    <button
      aria-label={label}
      className={cx(styles.iconButton, className)}
      data-size={size}
      data-variant={variant}
      type={type}
      {...props}
    />
  );
}

/**
 * Renders link navigation with button-like visual treatment.
 */
export function LinkButton({
  children,
  className,
  size = 'md',
  variant = 'secondary',
  ...props
}: LinkButtonProps): ReactNode {
  return (
    <a
      className={cx(styles.linkButton, className)}
      data-size={size}
      data-variant={variant}
      {...props}
    >
      {children}
    </a>
  );
}

/**
 * Groups related action controls under one accessible name.
 */
export function ButtonGroup({
  children,
  className,
  label,
}: ButtonGroupProps): ReactNode {
  return (
    <div
      aria-label={label}
      className={cx(styles.buttonGroup, className)}
      role="group"
    >
      {children}
    </div>
  );
}

/**
 * Keeps supporting text available to assistive technology while visually hiding it.
 */
export function VisuallyHidden({
  children,
  className,
}: VisuallyHiddenProps): ReactNode {
  return (
    <span className={cx(styles.visuallyHidden, className)}>{children}</span>
  );
}
