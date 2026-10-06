import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';
import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import styles from './actions.module.css';
import { cx } from './class-name';

export type ActionVariant =
  | 'accent'
  | 'danger'
  | 'default'
  | 'destructive'
  | 'ghost'
  | 'link'
  | 'outline'
  | 'primary'
  | 'quiet'
  | 'secondary';
export type ActionSize =
  | 'icon'
  | 'icon-lg'
  | 'icon-sm'
  | 'lg'
  | 'md'
  | 'sm'
  | 'xs';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly asChild?: boolean;
  readonly size?: ActionSize;
  readonly variant?: ActionVariant;
}

/** The Button look for an element that is not a Button, such as a pager link. */
export interface ButtonVariantProps {
  readonly className: string;
  readonly 'data-size': ActionSize;
  readonly 'data-variant': ActionVariant;
}

/**
 * Returns the class and data attributes that give an element the shared Button
 * look, including its hover and workspace states. Spread them onto the
 * element and merge any layout class into `className`.
 *
 * @param options - The Button variant and size; default `secondary` / `md`.
 * @returns Props for the element.
 */
export function buttonVariants({
  size = 'md',
  variant = 'secondary',
}: {
  readonly size?: ActionSize;
  readonly variant?: ActionVariant;
} = {}): ButtonVariantProps {
  return {
    className: styles.button,
    'data-size': size,
    'data-variant': variant,
  };
}

/** Variants the icon-only button draws. */
export type IconButtonVariant = Extract<
  ActionVariant,
  'danger' | 'ghost' | 'primary' | 'secondary'
>;
/** Sizes the icon-only button draws. */
export type IconButtonSize = Extract<ActionSize, 'lg' | 'md' | 'sm'>;

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  readonly label: string;
  readonly size?: IconButtonSize;
  readonly variant?: IconButtonVariant;
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
      asChild = false,
      size = 'md',
      type = 'button',
      variant = 'secondary',
      ...props
    },
    ref,
  ): ReactNode {
    const Comp = asChild ? Slot : 'button';
    const look = buttonVariants({ size, variant });

    return (
      <Comp
        {...look}
        className={cx(look.className, className)}
        data-slot="button"
        ref={ref}
        {...(asChild ? {} : { type })}
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
 * Renders link navigation with the same variants and sizes as Button.
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
