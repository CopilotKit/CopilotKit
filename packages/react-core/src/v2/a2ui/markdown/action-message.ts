import { randomUUID } from "@copilotkit/shared";
import type { A2UIUserAction } from "../A2UIMessageRenderer";

/** Context keys that supply the message's leading sentence, in priority order. */
const TEXT_KEYS: readonly string[] = ["message", "label"];

/**
 * Turns an A2UI user action into the text of a visible user message.
 *
 * The first non-empty `context.message` / `context.label` leads; without one the
 * action name is humanized (`choose_plan` → "Choose plan"). Remaining context
 * values follow as `key: value` lines, objects as JSON.
 */
export function buildActionMessageText(action: A2UIUserAction): string {
  const ctx: Record<string, unknown> = action.context ?? {};
  const explicit = TEXT_KEYS.map((key) => ctx[key]).find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  const head = explicit ?? humanize(action.name);
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
}: {
  action: A2UIUserAction;
  agent: TAgent;
  copilotkit: A2UIActionMessageCore<TAgent>;
}): Promise<void> {
  agent.addMessage({
    id: randomUUID(),
    role: "user",
    content: buildActionMessageText(action),
  });
  await copilotkit.runAgent({ agent });
}
