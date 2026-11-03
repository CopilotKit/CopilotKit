import type { CopilotKitCore } from "../core";
import { A2UI_DEFAULT_SURFACE_ID } from "./constants";

/** A user action dispatched by an A2UI component (button click, form submit). */
export type A2UIUserAction = {
  name: string;
  sourceComponentId: string;
  surfaceId: string;
  timestamp: string;
  context?: Record<string, unknown>;
  dataContextPath?: string;
};

/**
 * The A2UI client-event envelope. The runtimes read it from
 * `forwardedProps.a2uiAction.userAction` (`@ag-ui/a2ui-middleware` and
 * `copilotkit_runtime.a2ui`), so an action must reach the agent wrapped in it.
 */
export interface A2UIClientEvent {
  userAction: A2UIUserAction;
}

/**
 * Intercept an A2UI user action before it reaches the agent.
 *
 * Called with the dispatched action and a `forward` helper that runs the agent
 * with the (optionally modified) action. The return value drives the default
 * forwarding:
 * - return `null` → the app handled it client-side (e.g. a `navigate` event);
 *   the action is NOT forwarded to the agent.
 * - return an `A2UIUserAction` → that (possibly modified) action is forwarded.
 * - return `undefined` / `void` → the original action is forwarded unchanged.
 *
 * `forward` is provided for advanced cases where you want to do async work and
 * forward manually; if you call it yourself, return `null` to suppress the
 * default forward and avoid running the agent twice.
 */
export type A2UIActionInterceptor = (
  action: A2UIUserAction,
  forward: (action?: A2UIUserAction) => Promise<void>,
) => void | A2UIUserAction | null | Promise<void | A2UIUserAction | null>;

/** The raw action a web_core `MessageProcessor` hands its action handler. */
export interface A2UIProcessorAction {
  name?: string;
  surfaceId?: string;
  sourceComponentId?: string;
  context?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Wraps a raw processor action in the client-event envelope the runtimes read,
 * filling the fields a partial action leaves out.
 *
 * @param action - What the `MessageProcessor` action handler received.
 */
export function toA2UIClientEvent(action: A2UIProcessorAction) {
  const event: A2UIClientEvent = {
    userAction: {
      name: action.name ?? "unknown",
      surfaceId: action.surfaceId ?? A2UI_DEFAULT_SURFACE_ID,
      sourceComponentId: action.sourceComponentId ?? "",
      context: action.context,
      timestamp: action.timestamp ?? new Date().toISOString(),
    },
  };
  return event;
}

/** The core members an A2UI action needs. */
export type A2UIActionCore = Pick<
  CopilotKitCore,
  "properties" | "setProperties" | "runAgent"
>;

/** The agent an A2UI action runs. */
export type A2UIActionAgent = Parameters<
  CopilotKitCore["runAgent"]
>[0]["agent"];

/**
 * Sends one A2UI user action to the agent: runs the optional `onAction`
 * interceptor first, then sets the `a2uiAction` run property and runs the
 * agent unless the interceptor suppressed it (returned `null`). The
 * `a2uiAction` property is always removed afterwards so it does not leak into
 * later runs.
 *
 * Does nothing when there is no agent (a surface rendered outside a chat).
 *
 * @example
 * ```ts
 * new MessageProcessor([catalog], (action) =>
 *   ɵrunA2UIAction({ message: ɵtoA2UIClientEvent(action), agent, core }),
 * );
 * ```
 */
export async function runA2UIAction({
  message,
  agent,
  core,
  onAction,
}: {
  message: A2UIClientEvent;
  agent: A2UIActionAgent | undefined;
  core: A2UIActionCore;
  onAction?: A2UIActionInterceptor;
}) {
  if (!agent) return;

  // Called with no argument → the original message is forwarded as-is;
  // otherwise the (possibly modified) userAction replaces the original while
  // the rest of the envelope is kept.
  const forward = async (forwardAction?: A2UIUserAction) => {
    const a2uiAction =
      forwardAction === undefined
        ? message
        : { ...message, userAction: forwardAction };
    try {
      core.setProperties({ ...core.properties, a2uiAction });
      await core.runAgent({ agent });
    } finally {
      const { a2uiAction: _removed, ...rest } = core.properties;
      core.setProperties(rest);
    }
  };

  if (onAction) {
    const result = await onAction(message.userAction, forward);
    if (result === null) return;
    if (result) {
      await forward(result);
      return;
    }
  }

  await forward();
}
