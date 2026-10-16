import { useEffect, useMemo, useRef } from "react";
import type { AbstractAgent, Message } from "@ag-ui/client";
import {
  COPILOTKIT_FORWARDED_PROPS_KEY,
  DEFAULT_AGENT_ID,
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_MARKDOWN_GUIDELINES,
  randomUUID,
} from "@copilotkit/shared";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import type { CopilotKitCoreReact } from "../lib/react-core";
import { useShallowStableRef } from "../lib/shallow-stable-ref";
import {
  buildActionMessageText,
  createComponentLabelResolver,
} from "./action-message";
import { createGenerativeUIDispatcher } from "./dispatcher";
import { GenerativeUIError } from "./errors";
import type { GenerativeUIErrorInfo } from "./errors";
import { buildGenerativeUIEnvelope } from "./manifest";
import type { GenerativeUIEnvelopeOptions } from "./manifest";
import type {
  GenerativeUIConfig,
  GenerativeUIRuntime,
} from "./runtime-context";
import { useGenerativeUIMarkdownContext } from "./markdown/context";
import { getMarkdownSurfaceSource } from "./markdown/source";
import { GenerativeUISurfaceManager } from "./surface-manager";
import type { ManagedSurface } from "./surface-manager";

const isDevelopment = () => process.env.NODE_ENV !== "production";

function ingestMessages(
  manager: GenerativeUISurfaceManager,
  agent: AbstractAgent,
  messages: ReadonlyArray<Readonly<Message>>,
) {
  if (!agent.threadId) return;
  for (const message of messages) {
    if (
      message.role === "activity" &&
      message.activityType === GENERATIVE_UI_ACTIVITY_TYPE
    ) {
      manager.ingest(
        agent.threadId,
        agent.agentId,
        message.content as unknown as GenerativeUISurfaceContent,
      );
    }
  }
}

/** What the envelope of a run says, from the provider config. */
function envelopeOptionsFor(
  config: GenerativeUIConfig,
): GenerativeUIEnvelopeOptions {
  if (config.transport === "markdown") {
    return {
      transport: "markdown",
      includeCatalog: config.includeCatalog !== false,
      contextSent: config.sendContext !== false,
      instructions: GENERATIVE_UI_MARKDOWN_GUIDELINES,
    };
  }
  return { transport: "tool", includeCatalog: true, contextSent: false };
}

/**
 * The components of a surface as one `updateComponents` operation, so that
 * the label of the component that sent an event can be found.
 */
function surfaceComponents(surface: ManagedSurface): A2UIOperation[] {
  const entries = [...surface.model.componentsModel.entries];
  const components = entries.map(([id, model]) => ({
    ...model.properties,
    id,
    component: model.type,
  }));
  return [
    {
      version: "v0.9",
      updateComponents: { surfaceId: surface.surfaceId, components },
    },
  ];
}

/** Provider-side wiring: manager, dispatcher, agent subscriptions, envelope. */
export function useGenerativeUIRoot(
  copilotkit: CopilotKitCoreReact,
  config: GenerativeUIConfig | undefined,
): GenerativeUIRuntime | null {
  const configRef = useRef(config);
  configRef.current = config;
  const ui = config?.ui;
  const transport = config?.transport ?? "tool";
  const theme = useShallowStableRef(config?.theme);

  // The parts that live as long as `ui`. The surfaces are in the manager, so
  // a new theme or transport does not remount them.
  const core = useMemo(() => {
    if (!ui) return null;
    // Never throws: it is called from rendering, ingestion and event handlers,
    // and a throwing host `onError` must not break any of them.
    const reportError = (info: GenerativeUIErrorInfo) => {
      try {
        configRef.current?.errorBoundary?.onError?.(info);
      } catch (hostError) {
        if (isDevelopment()) {
          console.error(
            "[generativeUI] errorBoundary.onError threw:",
            hostError,
          );
        }
      }
      if (isDevelopment()) {
        console.warn(
          `[generativeUI] ${info.kind} error in ${info.surfaceId}${info.componentId ? `/${info.componentId}` : ""}: ${info.error?.message}`,
        );
      }
    };
    const manager = new GenerativeUISurfaceManager(ui, {
      onOperationRejected: ({ surfaceId, index, reason }) =>
        reportError({
          kind: "operation",
          surfaceId,
          error: new Error(`operation ${index} rejected: ${reason}`),
        }),
    });
    const dispatcher = createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
      onError: ({ origin, error }) =>
        reportError({ kind: "function", ...origin, error }),
    });
    const forwardEvent: GenerativeUIRuntime["forwardEvent"] = async (
      event,
      agentId,
    ) => {
      const fail = (message: string) => {
        const error = new GenerativeUIError("event_forward_failed", message);
        reportError({
          kind: "event",
          surfaceId: event.surfaceId,
          componentId: event.componentId,
          error,
        });
        return { ok: false as const, error };
      };
      const agent = copilotkit.getAgent(agentId ?? DEFAULT_AGENT_ID);
      if (!agent) {
        return fail(`No agent "${agentId}" to receive "${event.name}"`);
      }
      try {
        // A visible user message: the user and the model both see the event.
        const surface = agent.threadId
          ? manager.getSurface(agent.threadId, event.surfaceId)
          : undefined;
        const resolveLabel = surface
          ? createComponentLabelResolver(surfaceComponents(surface))
          : undefined;
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content: buildActionMessageText(event, resolveLabel),
        });
        await copilotkit.runAgent({ agent });
        return { ok: true, result: undefined };
      } catch (cause) {
        return fail(
          `Forwarding "${event.name}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    };
    return { manager, dispatcher, ui, forwardEvent, reportError };
  }, [ui, copilotkit]);

  // A new object when the theme or the transport changes, so that the
  // components that read them render again.
  const runtime = useMemo<GenerativeUIRuntime | null>(() => {
    if (!core) return null;
    return {
      ...core,
      transport,
      theme,
      get config() {
        // `core` exists only while the provider has a config. After the
        // config is removed, nothing reads this runtime again.
        return configRef.current ?? { ui: core.ui };
      },
      get errorFallback() {
        return configRef.current?.errorBoundary?.fallback;
      },
    };
  }, [core, transport, theme]);

  useEffect(() => {
    if (!core) return;
    const watched = new WeakSet<AbstractAgent>();
    const agentSubscriptions: Array<{ unsubscribe(): void }> = [];
    let envelopeId: string | undefined;
    const removeEnvelope = () => {
      if (envelopeId === undefined) return;
      copilotkit.removeScopedProperties(envelopeId);
      envelopeId = undefined;
    };
    /**
     * The tool transport reads the surface activity messages. The markdown
     * transport reads the ```a2ui fences of the assistant messages, and
     * builds the surfaces of the thread from them again on each change.
     */
    const readMessages = (
      agent: AbstractAgent,
      messages: ReadonlyArray<Readonly<Message>>,
      running: boolean,
    ) => {
      if (configRef.current?.transport !== "markdown") {
        ingestMessages(core.manager, agent, messages);
        return;
      }
      const { threadId } = agent;
      if (!threadId) return;
      // A thread switch can happen with no run start. The named targets
      // must show the surfaces of the thread that the messages belong to.
      core.manager.setActiveThread(threadId);
      getMarkdownSurfaceSource(core).sync(threadId, agent.agentId, messages, {
        running,
      });
    };
    const subscription = copilotkit.subscribe({
      // Core awaits this before it reads the properties for the run, so the
      // envelope set here goes with this run. Tool-call follow-up runs do not
      // fire it. The scoped entry stays until the next run start replaces it,
      // so the follow-up runs send the same envelope.
      onAgentRunStarted: ({ agent }) => {
        core.manager.setActiveThread(agent.threadId);
        const latest = configRef.current;
        if (latest) {
          removeEnvelope();
          const envelope = buildGenerativeUIEnvelope(
            core,
            agent.threadId,
            envelopeOptionsFor(latest),
          );
          envelopeId = copilotkit.addScopedProperties({
            properties: { [COPILOTKIT_FORWARDED_PROPS_KEY]: { ui: envelope } },
            agentIds: latest.agentIds,
          });
        }
        if (!watched.has(agent)) {
          watched.add(agent);
          agentSubscriptions.push(
            agent.subscribe({
              onMessagesChanged: ({ messages }) =>
                readMessages(agent, messages, agent.isRunning),
              // The last message is final now. An open fence in it is final
              // too, so its surface is no longer "streaming".
              onRunFinalized: () => readMessages(agent, agent.messages, false),
              onRunFailed: () => readMessages(agent, agent.messages, false),
            }),
          );
        }
        readMessages(agent, agent.messages, agent.isRunning);
      },
    });
    return () => {
      subscription.unsubscribe();
      for (const s of agentSubscriptions) s.unsubscribe();
      // Stop advertising a generative UI that is no longer mounted.
      removeEnvelope();
    };
  }, [core, copilotkit]);

  useGenerativeUIMarkdownContext(copilotkit, core, {
    enabled: config?.transport === "markdown" && config.sendContext !== false,
    agentIds: config?.agentIds,
  });

  return runtime;
}
