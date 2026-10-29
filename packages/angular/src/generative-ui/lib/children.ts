import type { GenerativeUITemplateChildren } from "@copilotkit/shared";
import type { ManagedSurface } from "@copilotkit/core/generative-ui";

/**
 * Experimental. The children of a slot, or the value of a `child()` or
 * `childList()` prop: a handle on the components that go there. A component
 * renders it with the `*copilotGenerativeUIChildren` directive and does not
 * read it otherwise.
 *
 * @example
 * ```html
 * <section><ng-container *copilotGenerativeUIChildren="children()" /></section>
 * ```
 */
export interface GenerativeUIChildren {
  /** @internal */
  readonly surface: ManagedSurface;
  /** @internal The template item path these children render in, if any. */
  readonly basePath: string | undefined;
  /** @internal Scoped ids of the nodes above, to cut cyclic references. */
  readonly ancestors: readonly string[];
  /** @internal One id, a list of ids, or a template. */
  readonly value: string | readonly string[] | GenerativeUITemplateChildren;
}

/** A "multiple" slot value that repeats a component for each list item. */
export function isTemplateChildren(
  value: unknown,
): value is GenerativeUITemplateChildren {
  return (
    typeof value === "object" &&
    value !== null &&
    "componentId" in value &&
    typeof value.componentId === "string" &&
    "path" in value &&
    typeof value.path === "string"
  );
}

/** A handle for `value`, or `undefined` when it names no component. */
export function childrenHandle(
  surface: ManagedSurface,
  basePath: string | undefined,
  ancestors: readonly string[],
  value: unknown,
): GenerativeUIChildren | undefined {
  if (typeof value === "string") {
    return { surface, basePath, ancestors, value };
  }
  if (isTemplateChildren(value)) {
    return { surface, basePath, ancestors, value };
  }
  if (Array.isArray(value)) {
    // Dedupe so a repeated id renders once, as in React.
    const ids = [
      ...new Set(value.filter((id): id is string => typeof id === "string")),
    ];
    return { surface, basePath, ancestors, value: ids };
  }
  return undefined;
}
