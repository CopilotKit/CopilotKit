import { randomUUID } from "@copilotkit/shared";
import type { A2UIUserAction } from "../A2UIMessageRenderer";

/** Context keys that supply the message's leading sentence, in priority order. */
const TEXT_KEYS: readonly string[] = ["message", "label"];

/** Looks up the visible label of the component that dispatched an action. */
export type A2UIActionLabelResolver = (
  sourceComponentId: string,
) => string | undefined;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Turns an A2UI user action into the text of a visible user message.
 *
 * The leading sentence is, in order: `context.message`, `context.label`, the
 * source component's visible label (via `resolveLabel`), or the humanized
 * action name (`choose_plan` → "Choose plan"). Remaining context values follow
 * as `key: value` lines, objects as JSON.
 */
export function buildActionMessageText(
  action: A2UIUserAction,
  resolveLabel?: A2UIActionLabelResolver,
): string {
  const ctx: Record<string, unknown> = action.context ?? {};
  const explicit = TEXT_KEYS.map((key) => ctx[key]).find(nonEmptyString);
  const resolved = explicit
    ? undefined
    : resolveLabel?.(action.sourceComponentId);
  const head =
    explicit ??
    (nonEmptyString(resolved) ? resolved.trim() : humanize(action.name));
  const rest = Object.entries(ctx)
    .filter(
      ([key, value]) =>
        !TEXT_KEYS.includes(key) && value !== undefined && value !== null,
    )
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    );
  return rest.length ? `${head}\n\n${rest.join("\n")}` : head;
}

type ComponentRecord = Record<string, unknown>;

function ownText(component: ComponentRecord | undefined): string | undefined {
  if (!component) return undefined;
  if (nonEmptyString(component.label)) return component.label;
  if (nonEmptyString(component.text)) return component.text;
  return undefined;
}

/**
 * Builds a resolver from a surface's operations that finds an action source's
 * visible label: the component's own string `label`, else its string `text`,
 * else the first `child` / `children` component with a string `text` or
 * `label`. Later definitions of a component id win, as in the renderer.
 */
export function createComponentLabelResolver(
  operations: readonly unknown[],
): A2UIActionLabelResolver {
  const byId = new Map<string, ComponentRecord>();
  for (const op of operations) {
    const components = (op as { updateComponents?: { components?: unknown } })
      ?.updateComponents?.components;
    if (!Array.isArray(components)) continue;
    for (const component of components) {
      if (
        component &&
        typeof component === "object" &&
        typeof (component as ComponentRecord).id === "string"
      ) {
        byId.set(
          (component as ComponentRecord).id as string,
          component as ComponentRecord,
        );
      }
    }
  }
  return (sourceComponentId) => {
    const component = byId.get(sourceComponentId);
    if (!component) return undefined;
    const own = ownText(component);
    if (own) return own;
    const childIds = [
      ...(typeof component.child === "string" ? [component.child] : []),
      ...(Array.isArray(component.children)
        ? component.children.filter(
            (id): id is string => typeof id === "string",
          )
        : []),
    ];
    for (const id of childIds) {
      const text = ownText(byId.get(id));
      if (text) return text;
    }
    return undefined;
  };
}

function humanize(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** The slice of an agent this module needs. */
export type A2UIActionMessageAgent = {
  addMessage: (message: { id: string; role: "user"; content: string }) => void;
};

/** The slice of CopilotKitCore this module needs. */
export type A2UIActionMessageCore<TAgent> = {
  runAgent: (params: { agent: TAgent }) => Promise<unknown>;
};

/**
 * Markdown-mode action handling: appends the action as a visible user message
 * and runs the agent, the same way the chat input sends a typed message.
 */
export async function sendA2UIActionAsMessage<
  TAgent extends A2UIActionMessageAgent,
>({
  action,
  agent,
  copilotkit,
  resolveLabel,
}: {
  action: A2UIUserAction;
  agent: TAgent;
  copilotkit: A2UIActionMessageCore<TAgent>;
  /** Supplies the source component's label when the context has no text. */
  resolveLabel?: A2UIActionLabelResolver;
}): Promise<void> {
  agent.addMessage({
    id: randomUUID(),
    role: "user",
    content: buildActionMessageText(action, resolveLabel),
  });
  await copilotkit.runAgent({ agent });
}
