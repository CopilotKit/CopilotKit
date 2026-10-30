import React, { createElement, forwardRef } from "react";
import { ɵcopilotIcons, ɵcopilotIconSvgAttributes } from "@copilotkit/core";
import type { CopilotIconName } from "@copilotkit/core";
import { cn } from "../../lib/utils";

/** One SVG child element of an icon, such as a `<path>` or a `<circle>`. */
export interface IconSvgNode {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string | number>>;
}

/** Turns SVG attribute names such as `stroke-width` into React's `strokeWidth`. */
function toReactAttributes(attributes: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key.replace(/-([a-z])/g, (_match, letter: string) =>
        letter.toUpperCase(),
      ),
      value,
    ]),
  );
}

const svgDefaults = toReactAttributes(ɵcopilotIconSvgAttributes);

/** True when the props give the icon an accessible name or role. */
function hasAccessibleProp(props: object) {
  return Object.keys(props).some(
    (key) => key.startsWith("aria-") || key === "role" || key === "title",
  );
}

type SvgProps = React.ComponentPropsWithoutRef<"svg">;

/** Props of `IconSvg` and `CopilotIcon` that change how the icon is drawn. */
interface IconDrawProps extends SvgProps {
  /** Width and height of the icon. Defaults to `24`. */
  size?: number | string;
}

interface IconSvgProps extends IconDrawProps {
  /** The Lucide icon name in kebab case, for the `lucide-<name>` class. */
  lucideName: string;
  nodes: readonly IconSvgNode[];
}

/**
 * Internal. Draws a Lucide icon from its node data, the way Lucide's React package
 * does: Lucide's default SVG attributes, the `lucide lucide-<name>` classes,
 * and `aria-hidden="true"` when no `aria-*`, `role` or `title` prop names it.
 */
export const IconSvg = forwardRef<SVGSVGElement, IconSvgProps>(function IconSvg(
  {
    lucideName,
    nodes,
    size = 24,
    color = "currentColor",
    strokeWidth = 2,
    className,
    children,
    ...props
  },
  ref,
) {
  const isDecorative = !children && !hasAccessibleProp(props);
  return (
    <svg
      ref={ref}
      {...svgDefaults}
      width={size}
      height={size}
      stroke={color}
      strokeWidth={strokeWidth}
      className={cn("lucide", `lucide-${lucideName}`, className)}
      aria-hidden={isDecorative || undefined}
      {...props}
    >
      {nodes.map((node, index) =>
        createElement(node.tag, { key: index, ...node.attributes }),
      )}
      {children}
    </svg>
  );
});

/** Props of `CopilotIcon`. Any other SVG prop goes on the `<svg>`. */
export interface CopilotIconProps extends IconDrawProps {
  /** The chat icon to draw, for example `"ArrowUp"`. */
  name: CopilotIconName;
}

/**
 * Draws one of the chat icons as an inline `<svg>`.
 *
 * The `<svg>` has the classes `lucide lucide-<icon name>`, so CSS that selects
 * them (for example `svg.lucide-arrow-up`) keeps working. The icon is hidden
 * from screen readers unless you give it an `aria-label`, `role` or `title`.
 *
 * @param props.name - The chat icon, for example `"ArrowUp"` or `"X"`.
 * @param props.size - Width and height. Defaults to `24`.
 * @param props.strokeWidth - Line width. Defaults to `2`.
 * @param props.color - Line color. Defaults to `currentColor`.
 *
 * @example
 * ```tsx
 * <CopilotIcon name="ArrowUp" className="cpk-chat-input-send-icon" />
 * <CopilotIcon name="X" aria-label="Close" />
 * ```
 */
export const CopilotIcon = forwardRef<SVGSVGElement, CopilotIconProps>(
  function CopilotIcon({ name, ...props }, ref) {
    const icon = ɵcopilotIcons[name];
    return (
      <IconSvg ref={ref} lucideName={icon.name} nodes={icon.nodes} {...props} />
    );
  },
);
