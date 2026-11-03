import { useContext, useMemo } from "react";
import { GenerativeUINodeContext } from "./runtime-context";

/**
 * The `accessibility` of the A2UI 1.0 component envelope, with its dynamic
 * values resolved. Every component may carry it next to `id` and
 * `component`; it is not a prop of the component.
 */
export interface GenerativeUIAccessibility {
  /** A short name for assistive technologies, 1 to 3 words. */
  label?: string;
  /** Instructions, format requirements, or what an action does. */
  description?: string;
  /** How screen readers announce changes (WAI-ARIA `aria-live`). */
  live?: "off" | "polite" | "assertive";
  /** True hides the component and its children from assistive technologies. */
  hidden?: boolean;
}

/** The ARIA attributes of a resolved `accessibility`, ready to spread. */
export interface GenerativeUIAriaAttributes {
  "aria-label"?: string;
  "aria-description"?: string;
  "aria-live"?: "off" | "polite" | "assertive";
  "aria-hidden"?: true;
}

const LIVE = new Set(["off", "polite", "assertive"]);

/**
 * The accessibility of a component from its resolved `accessibility`
 * value. Fields of the wrong type are left out: a label that is still a
 * binding, or a list, names nothing.
 */
export function readAccessibility(
  value: unknown,
): GenerativeUIAccessibility | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const { label, description, live, hidden } = value as Record<string, unknown>;
  const result: GenerativeUIAccessibility = {};
  if (typeof label === "string" && label !== "") result.label = label;
  if (typeof description === "string" && description !== "") {
    result.description = description;
  }
  if (typeof live === "string" && LIVE.has(live)) {
    result.live = live as GenerativeUIAccessibility["live"];
  }
  if (typeof hidden === "boolean") result.hidden = hidden;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * The ARIA attributes for an `accessibility`. `live: "off"` is written out:
 * a region inherits the live setting of its ancestors, and a `status` role
 * is live on its own, so only the explicit value silences it.
 *
 * @example
 * ```ts
 * accessibilityAttributes({ label: "Totals", live: "polite" });
 * // { "aria-label": "Totals", "aria-live": "polite" }
 * ```
 */
export function accessibilityAttributes(
  accessibility: GenerativeUIAccessibility | undefined,
): GenerativeUIAriaAttributes {
  if (!accessibility) return {};
  const { label, description, live, hidden } = accessibility;
  return {
    ...(label === undefined ? {} : { "aria-label": label }),
    ...(description === undefined ? {} : { "aria-description": description }),
    ...(live === undefined ? {} : { "aria-live": live }),
    ...(hidden ? { "aria-hidden": true as const } : {}),
  };
}

/**
 * Experimental. The ARIA attributes of the `accessibility` that the model
 * gave the component being rendered, to spread on its root element. The
 * standard components do this; a custom component does it itself:
 *
 * @example
 * ```tsx
 * function Panel({ children }: { children?: ReactNode }) {
 *   const aria = useGenerativeUIAccessibility();
 *   return <section {...aria}>{children}</section>;
 * }
 * ```
 *
 * Outside of generated UI it gives `{}`.
 */
export function useGenerativeUIAccessibility(): GenerativeUIAriaAttributes {
  const node = useContext(GenerativeUINodeContext);
  const accessibility = node?.accessibility;
  return useMemo(() => accessibilityAttributes(accessibility), [accessibility]);
}

/**
 * The role of a container that the envelope names. A generic element
 * cannot carry a name, so a label or a description makes it a `group`,
 * unless the component has a role of its own.
 */
export function namedRole(
  aria: GenerativeUIAriaAttributes,
  explicit: string | undefined,
): string | undefined {
  if (explicit !== undefined) return explicit;
  const isNamed =
    aria["aria-label"] !== undefined || aria["aria-description"] !== undefined;
  return isNamed ? "group" : undefined;
}

/**
 * The part of the attributes for the focusable control of a labelled pair:
 * its name and its description. ARIA names are not inherited, so the
 * wrapper of a control cannot name it.
 */
export function controlAria(
  aria: GenerativeUIAriaAttributes,
): Pick<GenerativeUIAriaAttributes, "aria-label" | "aria-description"> {
  const { "aria-label": label, "aria-description": description } = aria;
  return {
    ...(label === undefined ? {} : { "aria-label": label }),
    ...(description === undefined ? {} : { "aria-description": description }),
  };
}

/**
 * The part of the attributes for the wrapper around a control: hidden and
 * live cover the label and the control together.
 */
export function wrapperAria(
  aria: GenerativeUIAriaAttributes,
): Pick<GenerativeUIAriaAttributes, "aria-hidden" | "aria-live"> {
  const { "aria-hidden": hidden, "aria-live": live } = aria;
  return {
    ...(hidden === undefined ? {} : { "aria-hidden": hidden }),
    ...(live === undefined ? {} : { "aria-live": live }),
  };
}
