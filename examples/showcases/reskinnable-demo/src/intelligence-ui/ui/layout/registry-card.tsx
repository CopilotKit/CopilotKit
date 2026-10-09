import type { ComponentProps } from 'react';
import { classNames } from '../class-names';
import styles from './registry-card.module.css';

/** Generated shadcn Card adapted from Tailwind classes to semantic CSS Modules. */
export function Card({
  className,
  ...props
}: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card"
      className={classNames(styles.card, className)}
      {...props}
    />
  );
}

/** Card title and supporting copy region. */
export function CardHeader({
  className,
  ...props
}: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card-header"
      className={classNames(styles.header, className)}
      {...props}
    />
  );
}

/** Visual heading inside a Card. The caller owns the semantic heading element. */
export function CardTitle({
  className,
  ...props
}: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card-title"
      className={classNames(styles.title, className)}
      {...props}
    />
  );
}

/** Supporting text inside a Card. */
export function CardDescription({
  className,
  ...props
}: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card-description"
      className={classNames(styles.description, className)}
      {...props}
    />
  );
}

/** Optional top-right action inside a Card header. */
export function CardAction({
  className,
  ...props
}: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card-action"
      className={classNames(styles.action, className)}
      {...props}
    />
  );
}

/** Main Card content with shared horizontal inset. */
export function CardContent({
  className,
  ...props
}: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card-content"
      className={classNames(styles.content, className)}
      {...props}
    />
  );
}

/** Card footer for compact actions. */
export function CardFooter({
  className,
  ...props
}: ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="card-footer"
      className={classNames(styles.footer, className)}
      {...props}
    />
  );
}
