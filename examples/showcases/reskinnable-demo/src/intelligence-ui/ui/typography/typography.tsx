import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../primitives/class-name";
import styles from "./typography.module.css";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingSize = "display" | "page" | "section" | "subsection";
export type TextElement = "div" | "p" | "span";
export type TextSize = "body" | "caption" | "lead" | "small";
export type TextTone = "danger" | "default" | "muted";
export type MonoTextElement = "code" | "p" | "span";
export type MonoTextTone = "accent" | "default" | "muted";
export type MonoTextTransform = "none" | "uppercase";

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  readonly children: ReactNode;
  readonly level?: HeadingLevel;
  readonly size?: HeadingSize;
}

export interface TextProps extends HTMLAttributes<HTMLElement> {
  readonly as?: TextElement;
  readonly children: ReactNode;
  readonly size?: TextSize;
  readonly tone?: TextTone;
}

export interface MonoTextProps extends HTMLAttributes<HTMLElement> {
  readonly as?: MonoTextElement;
  readonly children: ReactNode;
  readonly tone?: MonoTextTone;
  readonly transform?: MonoTextTransform;
}

export interface InlineCodeProps extends HTMLAttributes<HTMLElement> {
  readonly children: ReactNode;
}

/**
 * Renders a branded heading with semantic heading-level control.
 */
export function Heading({
  children,
  className,
  level = 2,
  size = "section",
  ...props
}: HeadingProps): ReactNode {
  const headingProps = {
    className: cx(styles.heading, className),
    "data-size": size,
    ...props,
  };

  switch (level) {
    case 1:
      return <h1 {...headingProps}>{children}</h1>;
    case 2:
      return <h2 {...headingProps}>{children}</h2>;
    case 3:
      return <h3 {...headingProps}>{children}</h3>;
    case 4:
      return <h4 {...headingProps}>{children}</h4>;
    case 5:
      return <h5 {...headingProps}>{children}</h5>;
    case 6:
      return <h6 {...headingProps}>{children}</h6>;
  }
}

/**
 * Renders branded prose, helper, and caption text.
 */
export function Text({
  as = "p",
  children,
  className,
  size = "body",
  tone = "default",
  ...props
}: TextProps): ReactNode {
  const textProps = {
    className: cx(styles.text, className),
    "data-size": size,
    "data-tone": tone,
    ...props,
  };

  if (as === "span") {
    return <span {...textProps}>{children}</span>;
  }

  if (as === "div") {
    return <div {...textProps}>{children}</div>;
  }

  return <p {...textProps}>{children}</p>;
}

/**
 * Renders short Spline Sans Mono details for labels, pills, and technical metadata.
 */
export function MonoText({
  as = "span",
  children,
  className,
  tone = "muted",
  transform = "uppercase",
  ...props
}: MonoTextProps): ReactNode {
  const monoProps = {
    className: cx(styles.monoText, className),
    "data-tone": tone,
    "data-transform": transform,
    ...props,
  };

  if (as === "code") {
    return <code {...monoProps}>{children}</code>;
  }

  if (as === "p") {
    return <p {...monoProps}>{children}</p>;
  }

  return <span {...monoProps}>{children}</span>;
}

/**
 * Renders inline code with the CopilotKit technical accent face.
 */
export function InlineCode({
  children,
  className,
  ...props
}: InlineCodeProps): ReactNode {
  return (
    <code className={cx(styles.inlineCode, className)} {...props}>
      {children}
    </code>
  );
}
