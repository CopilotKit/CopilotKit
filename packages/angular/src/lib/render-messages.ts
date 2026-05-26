import {
  computed,
  DestroyRef,
  inject,
  type Signal,
  type Type,
} from "@angular/core";
import type { AbstractAgent, ActivityMessage, Message } from "@ag-ui/client";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { CopilotKit } from "./copilotkit";

/**
 * Inputs delivered to a custom message renderer component.
 *
 * Mirrors the prop shape of React's `ReactCustomMessageRenderer`. Each
 * field corresponds to an `@Input()` (or signal `input()`) the rendering
 * component must accept.
 */
export interface CustomMessageRendererInputs {
  message: Message;
  position: CustomMessageRendererPosition;
  runId: string;
  messageIndex: number;
  messageIndexInRun: number;
  numberOfMessagesInRun: number;
  agentId: string;
  stateSnapshot: unknown;
}

export type CustomMessageRendererPosition = "before" | "after";

/**
 * Configuration for an Angular custom message renderer.
 *
 * Equivalent to React's `ReactCustomMessageRenderer`.
 */
export interface CustomMessageRendererConfig {
  /**
   * Optional agent id to scope this renderer to a particular agent.
   * Renderers without `agentId` apply to every agent.
   */
  agentId?: string;
  /**
   * Component rendered for each message; receives all
   * {@link CustomMessageRendererInputs} as inputs.
   *
   * `null` means "no rendering" — useful for conditionally disabling a
   * registered renderer without removing it.
   */
  component: Type<unknown> | null;
}

/**
 * Inputs delivered to an activity message renderer component.
 *
 * Mirrors `ReactActivityMessageRenderer`'s render prop shape.
 */
export interface ActivityMessageRendererInputs<TActivityContent = unknown> {
  activityType: string;
  content: TActivityContent;
  message: ActivityMessage;
  agent: AbstractAgent | undefined;
}

/**
 * Configuration for an Angular activity message renderer.
 *
 * Equivalent to React's `ReactActivityMessageRenderer`.
 */
export interface ActivityMessageRendererConfig<TActivityContent = unknown> {
  /**
   * Activity type to match. Use `"*"` as a wildcard renderer.
   */
  activityType: string;
  /**
   * Optional agent id to scope this renderer to a particular agent.
   */
  agentId?: string;
  /**
   * Standard Schema describing the expected `content` payload. Failed parses
   * fall through and the activity is not rendered.
   */
  content: StandardSchemaV1<unknown, TActivityContent>;
  /**
   * Component rendered for matching activities; receives all
   * {@link ActivityMessageRendererInputs} as inputs.
   */
  component: Type<unknown>;
}

/**
 * Resolved match returned by {@link injectRenderActivityMessage} when a
 * registered renderer applies to a given message.
 */
export interface ResolvedActivityMessageRender {
  component: Type<unknown>;
  inputs: ActivityMessageRendererInputs;
}

/**
 * Resolved match returned by {@link injectRenderCustomMessages} when a
 * registered renderer applies to a given (message, position) pair.
 */
export interface ResolvedCustomMessageRender {
  component: Type<unknown>;
  inputs: CustomMessageRendererInputs;
}

/**
 * Parameters passed to {@link InjectRenderCustomMessagesFn} when computing the
 * renderer + props for a particular message + position.
 */
export interface InjectRenderCustomMessagesParams {
  message: Message;
  position: CustomMessageRendererPosition;
}

export type InjectRenderCustomMessagesFn = (
  params: InjectRenderCustomMessagesParams,
) => ResolvedCustomMessageRender | null;

/**
 * Look up an activity-message renderer for a given {@link ActivityMessage}.
 *
 * Mirrors React's `useRenderActivityMessage`: the registered renderers are
 * filtered by `activityType` and resolved with the precedence
 *
 * 1. Renderer matching the active `agentId`,
 * 2. Renderer with no `agentId` set (global),
 * 3. Wildcard renderer (`activityType === "*"`).
 *
 * Failed schema parses are reported via `console.warn` and produce `null`.
 *
 * Must be invoked in an Angular DI context.
 */
export function injectRenderActivityMessage(input?: {
  agentId?: string | Signal<string | undefined>;
  threadId?: string | Signal<string | undefined>;
}): {
  /** Resolve a renderer for the message, or `null` if no match. */
  renderActivityMessage: (
    message: ActivityMessage,
  ) => ResolvedActivityMessageRender | null;
  /** Find the registered renderer config for an activity type. */
  findRenderer: (activityType: string) => ActivityMessageRendererConfig | null;
} {
  const copilotkit = inject(CopilotKit);
  const agentIdSignal = toSignal(input?.agentId);
  const threadIdSignal = toSignal(input?.threadId);

  const findRenderer = (
    activityType: string,
  ): ActivityMessageRendererConfig | null => {
    const renderers = copilotkit.renderActivityMessageConfigs();
    if (!renderers.length) return null;
    const agentId = agentIdSignal() ?? DEFAULT_AGENT_ID;

    const matches = renderers.filter((r) => r.activityType === activityType);

    return (
      matches.find((c) => c.agentId === agentId) ??
      matches.find((c) => c.agentId === undefined) ??
      renderers.find((c) => c.activityType === "*") ??
      null
    );
  };

  const renderActivityMessage = (
    message: ActivityMessage,
  ): ResolvedActivityMessageRender | null => {
    const renderer = findRenderer(message.activityType);
    if (!renderer) return null;

    const parseResult = renderer.content["~standard"].validate(message.content);
    // StandardSchema.validate() may return a Promise; for synchronous schemas
    // (the common case) the result is a `{ value }` or `{ issues }` record.
    if (parseResult instanceof Promise) {
      console.warn(
        `Activity renderer for '${message.activityType}' uses an async schema; async validation is not supported.`,
      );
      return null;
    }
    if ("issues" in parseResult && parseResult.issues) {
      console.warn(
        `Failed to parse content for activity message '${message.activityType}':`,
        parseResult.issues,
      );
      return null;
    }

    const value = (parseResult as { value: unknown }).value;
    const agentId = agentIdSignal() ?? DEFAULT_AGENT_ID;
    const threadId = threadIdSignal();
    const registryAgent = copilotkit.getAgent(agentId);
    // Prefer the per-thread clone so action handlers in the renderer call
    // runAgent on the same instance the chat view renders from.
    const agent =
      copilotkit.getThreadClone(registryAgent, threadId) ?? registryAgent;

    return {
      component: renderer.component,
      inputs: {
        activityType: message.activityType,
        content: value,
        message,
        agent,
      },
    };
  };

  return { renderActivityMessage, findRenderer };
}

/**
 * Build a custom-message renderer resolver. The returned function, when
 * called with a (`message`, `position`) pair, returns the matching renderer
 * config and props or `null`.
 *
 * Mirrors React's `useRenderCustomMessages`: agent-scoped renderers are
 * preferred over global ones, the per-thread clone (if any) is used to read
 * messages, and renderers whose `component` field is `null` are skipped (the
 * search continues with the next renderer until a non-null component is
 * found).
 *
 * Must be invoked in an Angular DI context.
 */
export function injectRenderCustomMessages(input?: {
  agentId?: string | Signal<string | undefined>;
  threadId?: string | Signal<string | undefined>;
}): InjectRenderCustomMessagesFn {
  const copilotkit = inject(CopilotKit);
  const agentIdSignal = toSignal(input?.agentId);
  const threadIdSignal = toSignal(input?.threadId);

  return ({ message, position }) => {
    const agentId = agentIdSignal() ?? DEFAULT_AGENT_ID;
    const threadId = threadIdSignal();

    const all = copilotkit.renderCustomMessageConfigs();
    if (!all.length) return null;

    const candidates = all
      .filter((r) => r.agentId === undefined || r.agentId === agentId)
      .sort((a, b) => {
        const aHasAgent = a.agentId !== undefined;
        const bHasAgent = b.agentId !== undefined;
        if (aHasAgent === bHasAgent) return 0;
        return aHasAgent ? -1 : 1;
      });

    if (!candidates.length) return null;

    const resolvedRunId =
      copilotkit.core.getRunIdForMessage(agentId, threadId ?? "", message.id) ??
      copilotkit.core.getRunIdsForThread(agentId, threadId ?? "").slice(-1)[0];
    const runId = resolvedRunId ?? `missing-run-id:${message.id}`;

    const registryAgent = copilotkit.getAgent(agentId);
    const agent =
      copilotkit.getThreadClone(registryAgent, threadId) ?? registryAgent;
    if (!agent) return null;

    const messageIdsInRun = resolvedRunId
      ? agent.messages
          .filter(
            (m) =>
              copilotkit.core.getRunIdForMessage(
                agentId,
                threadId ?? "",
                m.id,
              ) === resolvedRunId,
          )
          .map((m) => m.id)
      : [message.id];

    const rawMessageIndex = agent.messages.findIndex(
      (m) => m.id === message.id,
    );
    const messageIndex = rawMessageIndex >= 0 ? rawMessageIndex : 0;
    const messageIndexInRun = resolvedRunId
      ? Math.max(messageIdsInRun.indexOf(message.id), 0)
      : 0;
    const numberOfMessagesInRun = resolvedRunId ? messageIdsInRun.length : 1;
    const stateSnapshot = resolvedRunId
      ? copilotkit.core.getStateByRun(agentId, threadId ?? "", resolvedRunId)
      : undefined;

    for (const renderer of candidates) {
      if (!renderer.component) continue;
      return {
        component: renderer.component,
        inputs: {
          message,
          position,
          runId,
          messageIndex,
          messageIndexInRun,
          numberOfMessagesInRun,
          agentId,
          stateSnapshot,
        },
      };
    }
    return null;
  };
}

/**
 * Register an activity-message renderer for the lifetime of the calling
 * Angular DI context (cleared automatically on `DestroyRef` teardown).
 *
 * Equivalent in spirit to passing a renderer via React's
 * `<CopilotKitProvider renderActivityMessages={...}>` prop, but scoped to an
 * Angular component or directive instead of a provider.
 *
 * Must be called inside an Angular DI / injection context.
 */
export function registerRenderActivityMessage<TActivityContent = unknown>(
  config: ActivityMessageRendererConfig<TActivityContent>,
): void {
  const copilotkit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);
  copilotkit.addRenderActivityMessage(
    config as ActivityMessageRendererConfig<unknown>,
  );
  destroyRef.onDestroy(() => {
    copilotkit.removeRenderActivityMessage(
      config as ActivityMessageRendererConfig<unknown>,
    );
  });
}

/**
 * Register a custom-message renderer for the lifetime of the calling
 * Angular DI context (cleared automatically on `DestroyRef` teardown).
 *
 * Equivalent in spirit to passing a renderer via React's
 * `<CopilotKitProvider renderCustomMessages={...}>` prop.
 *
 * Must be called inside an Angular DI / injection context.
 */
export function registerRenderCustomMessage(
  config: CustomMessageRendererConfig,
): void {
  const copilotkit = inject(CopilotKit);
  const destroyRef = inject(DestroyRef);
  copilotkit.addRenderCustomMessage(config);
  destroyRef.onDestroy(() => {
    copilotkit.removeRenderCustomMessage(config);
  });
}

function toSignal<T>(value: T | Signal<T> | undefined): Signal<T | undefined> {
  if (value === undefined) {
    return computed(() => undefined);
  }
  if (typeof value === "function") {
    return value as Signal<T>;
  }
  return computed(() => value);
}
