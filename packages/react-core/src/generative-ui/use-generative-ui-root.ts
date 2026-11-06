import { useEffect, useMemo, useRef } from "react";
import type { AbstractAgent } from "@ag-ui/client";
import {
  COPILOTKIT_FORWARDED_PROPS_KEY,
  DEFAULT_AGENT_ID,
  GENERATIVE_UI_ACTIVITY_TYPE,
  randomUUID,
  toA2UIActionMessage,
} from "@copilotkit/shared";
import type {
  A2UIActionMessage,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import type { CopilotKitCoreReact } from "../lib/react-core";
import { useShallowStableRef } from "../lib/shallow-stable-ref";
import {
  buildActionMessageText,
  envelopeOptionsFor,
  surfaceLabelResolver,
} from "@copilotkit/core/generative-ui";
import {
  createGenerativeUIDebugSource,
  describeGenerativeUIRun,
} from "@copilotkit/core/generative-ui";
import { createGenerativeUIDispatcher } from "@copilotkit/core/generative-ui";
import { GenerativeUIError } from "@copilotkit/shared/generative-ui";
import type { GenerativeUIErrorInfo } from "@copilotkit/shared/generative-ui";
import { catalogIdsOf } from "./catalog";
import { buildGenerativeUIEnvelope } from "@copilotkit/core/generative-ui";
import type {
  GenerativeUIConfig,
  GenerativeUIRuntime,
} from "./runtime-context";
import { useGenerativeUIMarkdownContext } from "./markdown/context";
import { getMarkdownSurfaceSource } from "@copilotkit/core/generative-ui";
import {
  activityFunctionCalls,
  createFunctionCallRunner,
  markdownFunctionCalls,
} from "@copilotkit/core/generative-ui";
import type { ReadonlyMessages } from "@copilotkit/core/generative-ui";
import { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";

const isDevelopment = () => process.env.NODE_ENV !== "production";

function ingestMessages(
  manager: GenerativeUISurfaceManager,
  agent: AbstractAgent,
  messages: ReadonlyMessages,
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
      onError: ({ name, origin, error }) => {
        if ("functionCallId" in origin) {
          // The model gets this error in the answer of the call. The error
          // info of `onError` needs a surface, and this call has none.
          if (isDevelopment()) {
            console.warn(
              `[generativeUI] function call ${origin.functionCallId} to "${name}" failed: ${error.message}`,
            );
          }
          return;
        }
        reportError({ kind: "function", ...origin, error });
      },
    });
    const functionCalls = createFunctionCallRunner({
      core: copilotkit,
      dispatcher,
      manifest: {
        catalogId: ui.id,
        catalogIds: catalogIdsOf(ui),
        components: ui.manifestComponents,
      },
      // As for a frontend-tool follow-up: let React commit the state that
      // the handlers set, so that the follow-up run reads it.
      settle: () => copilotkit.waitForPendingFrameworkUpdates(),
      warn: (message, error) => {
        if (isDevelopment()) console.warn(message, error);
      },
    });
    // The agents with an event on its way to a run. Set before the run
    // starts, so a repeat click in the same tick is caught too.
    const forwardingAgents = new Set<AbstractAgent>();
    /**
     * The action of a user event, as an envelope entry scoped to the agent
     * the user acted on, for the run that the event starts: the structured
     * form of the user message. It is set before the run starts and dropped
     * when the run is over, so a suggestion request or a follow-up run
     * (both read the properties with no run start) does not carry the same
     * action again, and another agent never gets a click meant for this one.
     * The entry comes after the shared envelope, so it wins for its agent;
     * `refreshActions` keeps it last when the shared envelope is set again.
     */
    const actions = new Map<
      AbstractAgent,
      {
        id: string;
        action: A2UIActionMessage;
        /** Drops the action when the run ends, before any follow-up run. */
        subscription: { unsubscribe(): void };
      }
    >();
    const dropAction = (agent: AbstractAgent) => {
      const entry = actions.get(agent);
      if (!entry) return;
      entry.subscription.unsubscribe();
      copilotkit.removeScopedProperties(entry.id);
      actions.delete(agent);
    };
    const setAction = (agent: AbstractAgent, action: A2UIActionMessage) => {
      const previous = actions.get(agent);
      previous?.subscription.unsubscribe();
      if (previous) copilotkit.removeScopedProperties(previous.id);
      actions.delete(agent);
      const latest = configRef.current;
      if (!latest) return;
      const envelope = buildGenerativeUIEnvelope(
        { ui, manager, dispatcher },
        agent.threadId,
        { ...envelopeOptionsFor(latest), action },
      );
      const id = copilotkit.addScopedProperties({
        properties: { [COPILOTKIT_FORWARDED_PROPS_KEY]: { ui: envelope } },
        agentIds:
          agent.agentId === undefined ? latest.agentIds : [agent.agentId],
      });
      // The run ends before `runAgent` resolves: a frontend tool makes a
      // follow-up run first, and that run must not carry the action again.
      // The agent itself says when its run is over.
      const subscription = agent.subscribe({
        onRunFinalized: () => dropAction(agent),
        onRunFailed: () => dropAction(agent),
      });
      actions.set(agent, { id, action, subscription });
    };
    const refreshActions = () => {
      for (const [agent, { action }] of [...actions]) setAction(agent, action);
    };
    const dropAllActions = () => {
      for (const agent of [...actions.keys()]) dropAction(agent);
    };
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
      // An event is a one-click send. While the agent runs, or another event
      // is on its way, a second one is almost always a repeat: a double
      // click, or a click while the reply streams. Sending it would start a
      // second run and derail the chat, so it is dropped. The component gets
      // `agent_busy`; it is not an error of the UI, so nothing is reported.
      if (agent.isRunning || forwardingAgents.has(agent)) {
        return {
          ok: false as const,
          error: new GenerativeUIError(
            "agent_busy",
            `"${event.name}" was not sent: the agent is running`,
          ),
        };
      }
      forwardingAgents.add(agent);
      try {
        // A visible user message: the user and the model both see the event.
        const surface = agent.threadId
          ? manager.getSurface(agent.threadId, event.surfaceId)
          : undefined;
        const resolveLabel = surface
          ? surfaceLabelResolver(surface)
          : undefined;
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content: buildActionMessageText(event, resolveLabel),
        });
        // Set now, not at the run start: while another agent runs, this
        // run starts with no run-start notification.
        setAction(agent, toA2UIActionMessage(event));
        await copilotkit.runAgent({ agent });
        return { ok: true, result: undefined };
      } catch (cause) {
        return fail(
          `Forwarding "${event.name}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      } finally {
        forwardingAgents.delete(agent);
        dropAction(agent);
      }
    };
    return {
      manager,
      dispatcher,
      ui,
      forwardEvent,
      reportError,
      functionCalls,
      refreshActions,
      dropAllActions,
    };
  }, [ui, copilotkit]);

  // A new object when the theme or the transport changes, so that the
  // components that read them render again.
  const runtime = useMemo<GenerativeUIRuntime | null>(() => {
    if (!core) return null;
    const { manager, dispatcher, forwardEvent, reportError } = core;
    return {
      manager,
      dispatcher,
      ui: core.ui,
      forwardEvent,
      reportError,
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
    // The inspector reads the catalog, the surfaces, and the runs from it.
    const debug = createGenerativeUIDebugSource(core, () => {
      const latest = configRef.current ?? { ui: core.ui };
      return {
        options: envelopeOptionsFor(latest),
        agentIds: latest.agentIds,
      };
    });
    copilotkit.ɵsetGenerativeUIDebugSource(debug.source);
    const removeEnvelope = () => {
      if (envelopeId === undefined) return;
      copilotkit.removeScopedProperties(envelopeId);
      envelopeId = undefined;
    };
    /**
     * Sets the shared envelope of the run. The action entries of the agents
     * with a user event under way (see `forwardEvent`) are set again after
     * it, so they stay the last entries and win for their agents.
     */
    const setEnvelope = (agent: AbstractAgent, latest: GenerativeUIConfig) => {
      removeEnvelope();
      const run = describeGenerativeUIRun(
        core,
        agent.threadId,
        envelopeOptionsFor(latest),
      );
      envelopeId = copilotkit.addScopedProperties({
        properties: {
          [COPILOTKIT_FORWARDED_PROPS_KEY]: { ui: run.envelope },
        },
        agentIds: latest.agentIds,
      });
      core.refreshActions();
      const isForAgent =
        !latest.agentIds || latest.agentIds.includes(agent.agentId ?? "");
      if (isForAgent) {
        debug.recordRun({
          ...run,
          agentId: agent.agentId,
          threadId: agent.threadId,
          startedAt: Date.now(),
        });
      }
    };
    /**
     * The tool transport reads the surface activity messages. The markdown
     * transport reads the ```a2ui fences of the assistant messages, and
     * builds the surfaces of the thread from them again on each change.
     * Both give their function calls to the one runner.
     */
    const readMessages = (
      agent: AbstractAgent,
      messages: ReadonlyMessages,
      running: boolean,
    ) => {
      const requests = activityFunctionCalls(messages);
      const { threadId } = agent;
      if (configRef.current?.transport !== "markdown") {
        ingestMessages(core.manager, agent, messages);
      } else if (threadId) {
        // A thread switch can happen with no run start. The named targets
        // must show the surfaces of the thread that the messages belong to.
        core.manager.setActiveThread(threadId);
        const calls = getMarkdownSurfaceSource(core).sync(
          threadId,
          agent.agentId,
          messages,
          { running },
        );
        requests.push(...markdownFunctionCalls(calls));
      }
      core.functionCalls.run(agent, requests, messages, running);
    };
    const subscription = copilotkit.subscribe({
      // Core awaits this before it reads the properties for the run, so the
      // envelope set here goes with this run. Tool-call follow-up runs do not
      // fire it. The scoped entry stays until the next run start replaces it,
      // so the follow-up runs send the same envelope.
      onAgentRunStarted: ({ agent }) => {
        core.manager.setActiveThread(agent.threadId);
        const latest = configRef.current;
        if (latest) setEnvelope(agent, latest);
        if (!watched.has(agent)) {
          watched.add(agent);
          agentSubscriptions.push(
            agent.subscribe({
              onMessagesChanged: ({ messages }) =>
                readMessages(agent, messages, agent.isRunning),
              // The last message is final now. An open fence in it is final
              // too, so its surface is no longer "streaming". The function
              // calls of the run get their answers now.
              onRunFinalized: () => readMessages(agent, agent.messages, false),
              onRunFailed: () => readMessages(agent, agent.messages, false),
            }),
          );
        }
        // The run starts now, but the agent is not marked as running yet.
        readMessages(agent, agent.messages, true);
      },
    });
    return () => {
      subscription.unsubscribe();
      for (const s of agentSubscriptions) s.unsubscribe();
      // Stop advertising a generative UI that is no longer mounted.
      core.dropAllActions();
      removeEnvelope();
      if (copilotkit.ɵgenerativeUIDebugSource === debug.source) {
        copilotkit.ɵsetGenerativeUIDebugSource(undefined);
      }
    };
  }, [core, copilotkit]);

  useGenerativeUIMarkdownContext(copilotkit, core, {
    enabled: config?.transport === "markdown" && config.sendContext !== false,
    agentIds: config?.agentIds,
  });

  return runtime;
}
