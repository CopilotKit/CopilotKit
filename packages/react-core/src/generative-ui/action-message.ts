import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUIUserEvent,
} from "@copilotkit/shared";

/** Context keys that supply the message's first line, in priority order. */
const TEXT_KEYS: readonly string[] = ["message", "label"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** `choose_plan`, `choose-plan` and `choosePlan` all become "Choose plan". */
function humanize(name: string) {
  const spaced = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatContextValue(value: unknown) {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Turns a user event that no function handles into the text of a visible
 * user message.
 *
 * The first line is, in order: `userMessage`, `context.message`,
 * `context.label`, the label of the source component (from `resolveLabel`),
 * or the event name made readable (`choose_plan` becomes "Choose plan").
 * Each other context field follows as one `key: value` line. Objects are
 * written as JSON. `null` and `undefined` fields are skipped.
 *
 * @param event - The user event, as sent by a surface.
 * @param resolveLabel - Finds the visible label of a component by id. Build
 *   one with {@link createComponentLabelResolver}.
 *
 * @example
 * ```ts
 * buildActionMessageText({
 *   name: "choose_plan",
 *   surfaceId: "plans",
 *   componentId: "team-button",
 *   userMessage: "I pick the Team plan",
 *   context: { seats: 12 },
 * });
 * // "I pick the Team plan\n\nseats: 12"
 * ```
 */
export function buildActionMessageText(
  event: GenerativeUIUserEvent,
  resolveLabel?: (componentId: string) => string | undefined,
) {
  const { context, userMessage } = event;
  const candidates = [userMessage, ...TEXT_KEYS.map((key) => context[key])];
  const explicit = candidates.find(isNonEmptyString);
  const resolved = explicit ? undefined : resolveLabel?.(event.componentId);
  const head =
    explicit ??
    (isNonEmptyString(resolved) ? resolved.trim() : humanize(event.name));

  const fields = Object.entries(context);
  const lines = fields
    .filter(
      ([key, value]) =>
        !TEXT_KEYS.includes(key) && value !== undefined && value !== null,
    )
    .map(([key, value]) => `${key}: ${formatContextValue(value)}`);

  return lines.length > 0 ? `${head}\n\n${lines.join("\n")}` : head;
}

function ownText(component: A2UIComponentNode | undefined) {
  if (!component) return undefined;
  if (isNonEmptyString(component.label)) return component.label;
  if (isNonEmptyString(component.text)) return component.text;
  return undefined;
}

function childIds(component: A2UIComponentNode) {
  const { child, children } = component;
  const single = typeof child === "string" ? [child] : [];
  const multiple = Array.isArray(children)
    ? children.filter((id): id is string => typeof id === "string")
    : [];
  return [...single, ...multiple];
}

/** The components that an operation adds, inline or in an update. */
function componentsOf(operation: A2UIOperation) {
  if ("createSurface" in operation) {
    return operation.createSurface.components ?? [];
  }
  if ("updateComponents" in operation) {
    return operation.updateComponents.components;
  }
  return [];
}

/**
 * Builds a function that finds the visible label of a component on a surface.
 *
 * The label is the component's own string `label`, else its string `text`,
 * else the first `child` or `children` component that has a string `label`
 * or `text`. When a component id is defined more than once, the last
 * definition wins, as in the renderer.
 *
 * @param operations - The committed operations of the surface.
 *
 * @example
 * ```ts
 * const resolveLabel = createComponentLabelResolver(surface.operations);
 * buildActionMessageText(event, resolveLabel);
 * ```
 */
export function createComponentLabelResolver(
  operations: readonly A2UIOperation[],
) {
  const byId = new Map<string, A2UIComponentNode>();
  for (const operation of operations) {
    const components = componentsOf(operation);
    for (const component of components) {
      byId.set(component.id, component);
    }
  }

  return (componentId: string) => {
    const component = byId.get(componentId);
    if (!component) return undefined;
    const own = ownText(component);
    if (own) return own;
    const ids = childIds(component);
    for (const id of ids) {
      const text = ownText(byId.get(id));
      if (text) return text;
    }
    return undefined;
  };
}
