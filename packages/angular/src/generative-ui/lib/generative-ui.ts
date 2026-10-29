import {
  ApplicationRef,
  DestroyRef,
  Injectable,
  inject,
  isDevMode,
  isSignal,
  signal,
} from "@angular/core";
import type { Signal, Type } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKit } from "@copilotkit/angular";
import {
  A2UI_VERSION,
  COPILOTKIT_FORWARDED_PROPS_KEY,
  DEFAULT_AGENT_ID,
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_RENDER_TOOL,
  randomUUID,
  toA2UIActionMessage,
} from "@copilotkit/shared";
import type {
  A2UIActionMessage,
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import {
  GenerativeUISurfaceManager,
  buildActionMessageText,
  buildGenerativeUIEnvelope,
  createComponentLabelResolver,
  createGenerativeUIDebugSource,
  createGenerativeUIDispatcher,
  describeGenerativeUIRun,
  getMarkdownSurfaceSource,
} from "@copilotkit/core/generative-ui";
import type {
  GenerativeUIDispatcher,
  GenerativeUIEngine,
  GenerativeUIEnvelopeOptions,
  ManagedSurface,
} from "@copilotkit/core/generative-ui";
import { GenerativeUIError } from "@copilotkit/shared/generative-ui";
import type {
  GenerativeUIErrorInfo,
  GenerativeUITheme,
} from "@copilotkit/shared/generative-ui";
import { z } from "zod";
import { catalogIdsOf } from "./catalog";
import type { GenerativeUI } from "./catalog";
import { CopilotGenerativeUIRenderToolCall } from "./chat";
import { GENERATIVE_UI_CONFIG } from "./config";
import type { GenerativeUIConfig } from "./config";
import {
  activityFunctionCalls,
  createFunctionCallRunner,
  markdownFunctionCalls,
} from "./function-calls";
import type { FunctionCallRunner, ReadonlyMessages } from "./function-calls";
import { registerGenerativeUIMarkdownContext } from "./markdown-context";
import type { GenerativeUIRuntime } from "./runtime";

/** What the envelope of a run says, from the config. */
function envelopeOptionsFor(
  config: GenerativeUIConfig,
): GenerativeUIEnvelopeOptions {
  if (config.transport === "markdown") {
    return {
      transport: "markdown",
      includeCatalog: config.includeCatalog !== false,
      contextSent: config.sendContext !== false,
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
      version: A2UI_VERSION,
      updateComponents: { surfaceId: surface.surfaceId, components },
    },
  ];
}

/** The action of a user event, on its way to the agent's run. */
interface PendingAction {
  id: string;
  action: A2UIActionMessage;
  /** Drops the action when the run ends, before any follow-up run. */
  subscription: { unsubscribe(): void };
}

/**
 * Experimental. The root of generative UI: the surfaces of every thread,
 * the function dispatcher, the envelope that tells the agent what it can
 * render, and the user events on their way to the agent. One per app;
 * `provideGenerativeUI` creates and starts it. Components and helpers
 * inject it through `GENERATIVE_UI_RUNTIME`.
 */
@Injectable({ providedIn: "root" })
export class CopilotGenerativeUI implements GenerativeUIRuntime {
  readonly #copilotkit = inject(CopilotKit);
  readonly #appRef = inject(ApplicationRef);
  readonly #config: GenerativeUIConfig;

  readonly ui: GenerativeUI;
  readonly transport: "tool" | "markdown";
  readonly theme: Signal<GenerativeUITheme | undefined>;
  readonly manager: GenerativeUISurfaceManager;
  readonly dispatcher: GenerativeUIDispatcher;
  readonly errorFallback: Type<unknown> | undefined;
  /** Changes on every surface-manager notification. */
  readonly version: Signal<number>;

  readonly #version = signal(0);
  readonly #functionCalls: FunctionCallRunner;
  /** The agents with an event on its way to a run. */
  readonly #forwardingAgents = new Set<AbstractAgent>();
  /**
   * The action of a user event, as an envelope entry scoped to the agent
   * the user acted on, for the run that the event starts: the structured
   * form of the user message. It is set before the run starts and dropped
   * when the run is over, so a suggestion request or a follow-up run
   * (both read the properties with no run start) does not carry the same
   * action again, and another agent never gets a click meant for this one.
   * The entry comes after the shared envelope, so it wins for its agent;
   * `#refreshActions` keeps it last when the shared envelope is set again.
   */
  readonly #actions = new Map<AbstractAgent, PendingAction>();
  #started = false;

  constructor() {
    const config = inject(GENERATIVE_UI_CONFIG, { optional: true });
    if (!config) {
      throw new Error(
        "CopilotGenerativeUI needs provideGenerativeUI({ ui }) in the application providers.",
      );
    }
    this.#config = config;
    this.ui = config.ui;
    this.transport = config.transport ?? "tool";
    this.theme = isSignal(config.theme)
      ? config.theme
      : signal(config.theme).asReadonly();
    this.errorFallback = config.errorFallback;
    this.version = this.#version.asReadonly();
    const { ui } = config;
    this.manager = new GenerativeUISurfaceManager(ui, {
      onOperationRejected: ({ surfaceId, index, reason }) =>
        this.reportError({
          kind: "operation",
          surfaceId,
          error: new Error(`operation ${index} rejected: ${reason}`),
        }),
    });
    this.dispatcher = createGenerativeUIDispatcher({
      getDeclared: () => ui.functions,
      onError: ({ name, origin, error }) => {
        if ("functionCallId" in origin) {
          // The model gets this error in the answer of the call. The error
          // info of `onError` needs a surface, and this call has none.
          if (isDevMode()) {
            console.warn(
              `[generativeUI] function call ${origin.functionCallId} to "${name}" failed: ${error.message}`,
            );
          }
          return;
        }
        this.reportError({ kind: "function", ...origin, error });
      },
    });
    this.#functionCalls = createFunctionCallRunner({
      core: this.#copilotkit.core,
      dispatcher: this.dispatcher,
      manifest: {
        catalogId: ui.id,
        catalogIds: catalogIdsOf(ui),
        components: ui.manifestComponents,
      },
      // A change detection tick runs the effects that connect app state, so
      // the follow-up run reads what the handlers set.
      settle: async () => {
        await this.#copilotkit.core.waitForPendingFrameworkUpdates();
        try {
          this.#appRef.tick();
        } catch {
          // A tick that is already running covers it.
        }
      },
      warn: (message, error) => {
        if (isDevMode()) console.warn(message, error);
      },
    });
    inject(DestroyRef).onDestroy(() => this.#stop?.());
  }

  /**
   * Reports an error to `onError`. Never throws: it is called from
   * rendering, ingestion and event handlers, and a throwing host `onError`
   * must not break any of them.
   */
  readonly reportError = (info: GenerativeUIErrorInfo): void => {
    try {
      this.#config.onError?.(info);
    } catch (hostError) {
      if (isDevMode()) {
        console.error("[generativeUI] onError threw:", hostError);
      }
    }
    if (isDevMode()) {
      console.warn(
        `[generativeUI] ${info.kind} error in ${info.surfaceId}${info.componentId ? `/${info.componentId}` : ""}: ${info.error?.message}`,
      );
    }
  };

  /**
   * Sends a user event to the agent as a user message, with its A2UI action
   * in the envelope of the run it starts. An event while the agent runs, or
   * while another event is on its way, is dropped with `agent_busy`: it is
   * almost always a repeat, and sending it would start a second run.
   */
  readonly forwardEvent: GenerativeUIEngine["forwardEvent"] = async (
    event,
    agentId,
  ) => {
    const core = this.#copilotkit.core;
    const fail = (message: string) => {
      const error = new GenerativeUIError("event_forward_failed", message);
      this.reportError({
        kind: "event",
        surfaceId: event.surfaceId,
        componentId: event.componentId,
        error,
      });
      return { ok: false as const, error };
    };
    const agent = core.getAgent(agentId ?? DEFAULT_AGENT_ID);
    if (!agent) {
      return fail(`No agent "${agentId}" to receive "${event.name}"`);
    }
    if (agent.isRunning || this.#forwardingAgents.has(agent)) {
      return {
        ok: false as const,
        error: new GenerativeUIError(
          "agent_busy",
          `"${event.name}" was not sent: the agent is running`,
        ),
      };
    }
    this.#forwardingAgents.add(agent);
    try {
      // A visible user message: the user and the model both see the event.
      const surface = agent.threadId
        ? this.manager.getSurface(agent.threadId, event.surfaceId)
        : undefined;
      const resolveLabel = surface
        ? createComponentLabelResolver(surfaceComponents(surface))
        : undefined;
      agent.addMessage({
        id: randomUUID(),
        role: "user",
        content: buildActionMessageText(event, resolveLabel),
      });
      // Set now, not at the run start: while another agent runs, this run
      // starts with no run-start notification.
      this.#setAction(agent, toA2UIActionMessage(event));
      await core.runAgent({ agent });
      return { ok: true, result: undefined };
    } catch (cause) {
      return fail(
        `Forwarding "${event.name}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      this.#forwardingAgents.delete(agent);
      this.#dropAction(agent);
    }
  };

  #stop: (() => void) | undefined;

  /**
   * Starts the root: it follows the surfaces, sends the envelope with each
   * run, reads the messages of each agent and hides the `render_ui` tool
   * call in the chat. `provideGenerativeUI` calls it once at startup;
   * calling it again does nothing.
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const core = this.#copilotkit.core;
    const { manager } = this;
    const unsubscribeManager = manager.subscribe(() =>
      this.#version.update((n) => n + 1),
    );
    // The surface activity owns the chat UX; the raw tool call shows nothing.
    this.#copilotkit.addRenderToolCall({
      name: GENERATIVE_UI_RENDER_TOOL,
      args: z.any(),
      component: CopilotGenerativeUIRenderToolCall,
    });

    const watched = new WeakSet<AbstractAgent>();
    const agentSubscriptions: Array<{ unsubscribe(): void }> = [];
    let envelopeId: string | undefined;
    // The inspector reads the catalog, the surfaces, and the runs from it.
    const debug = createGenerativeUIDebugSource(this, () => ({
      options: envelopeOptionsFor(this.#config),
      agentIds: this.#config.agentIds,
    }));
    core.ɵsetGenerativeUIDebugSource(debug.source);
    const removeEnvelope = () => {
      if (envelopeId === undefined) return;
      core.removeScopedProperties(envelopeId);
      envelopeId = undefined;
    };
    /**
     * Sets the shared envelope of the run. The action entries of the agents
     * with a user event under way are set again after it, so they stay the
     * last entries and win for their agents.
     */
    const setEnvelope = (agent: AbstractAgent) => {
      removeEnvelope();
      const config = this.#config;
      const run = describeGenerativeUIRun(
        this,
        agent.threadId,
        envelopeOptionsFor(config),
      );
      envelopeId = core.addScopedProperties({
        properties: { [COPILOTKIT_FORWARDED_PROPS_KEY]: { ui: run.envelope } },
        agentIds: config.agentIds,
      });
      this.#refreshActions();
      const isForAgent =
        !config.agentIds || config.agentIds.includes(agent.agentId ?? "");
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
      if (this.transport !== "markdown") {
        if (threadId) {
          for (const message of messages) {
            if (
              message.role === "activity" &&
              message.activityType === GENERATIVE_UI_ACTIVITY_TYPE
            ) {
              manager.ingest(
                threadId,
                agent.agentId,
                message.content as unknown as GenerativeUISurfaceContent,
              );
            }
          }
        }
      } else if (threadId) {
        // A thread switch can happen with no run start. The named targets
        // must show the surfaces of the thread that the messages belong to.
        manager.setActiveThread(threadId);
        const calls = getMarkdownSurfaceSource(this).sync(
          threadId,
          agent.agentId,
          messages,
          { running },
        );
        requests.push(...markdownFunctionCalls(calls));
      }
      this.#functionCalls.run(agent, requests, messages, running);
    };
    const subscription = core.subscribe({
      // Core awaits this before it reads the properties for the run, so the
      // envelope set here goes with this run. Tool-call follow-up runs do not
      // fire it. The scoped entry stays until the next run start replaces it,
      // so the follow-up runs send the same envelope.
      onAgentRunStarted: ({ agent }) => {
        manager.setActiveThread(agent.threadId);
        setEnvelope(agent);
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
    const config = this.#config;
    const removeMarkdownContext =
      config.transport === "markdown" && config.sendContext !== false
        ? registerGenerativeUIMarkdownContext(core, this, config.agentIds)
        : undefined;

    this.#stop = () => {
      removeMarkdownContext?.();
      subscription.unsubscribe();
      for (const s of agentSubscriptions) s.unsubscribe();
      unsubscribeManager();
      // Stop advertising a generative UI that is no longer mounted.
      this.#dropAllActions();
      removeEnvelope();
      if (core.ɵgenerativeUIDebugSource === debug.source) {
        core.ɵsetGenerativeUIDebugSource(undefined);
      }
      this.#started = false;
    };
  }

  #dropAction(agent: AbstractAgent) {
    const entry = this.#actions.get(agent);
    if (!entry) return;
    entry.subscription.unsubscribe();
    this.#copilotkit.core.removeScopedProperties(entry.id);
    this.#actions.delete(agent);
  }

  #setAction(agent: AbstractAgent, action: A2UIActionMessage) {
    const core = this.#copilotkit.core;
    const previous = this.#actions.get(agent);
    previous?.subscription.unsubscribe();
    if (previous) core.removeScopedProperties(previous.id);
    this.#actions.delete(agent);
    const config = this.#config;
    const envelope = buildGenerativeUIEnvelope(this, agent.threadId, {
      ...envelopeOptionsFor(config),
      action,
    });
    const id = core.addScopedProperties({
      properties: { [COPILOTKIT_FORWARDED_PROPS_KEY]: { ui: envelope } },
      agentIds: agent.agentId === undefined ? config.agentIds : [agent.agentId],
    });
    // The run ends before `runAgent` resolves: a frontend tool makes a
    // follow-up run first, and that run must not carry the action again.
    // The agent itself says when its run is over.
    const subscription = agent.subscribe({
      onRunFinalized: () => this.#dropAction(agent),
      onRunFailed: () => this.#dropAction(agent),
    });
    this.#actions.set(agent, { id, action, subscription });
  }

  #refreshActions() {
    for (const [agent, { action }] of [...this.#actions]) {
      this.#setAction(agent, action);
    }
  }

  #dropAllActions() {
    for (const agent of [...this.#actions.keys()]) this.#dropAction(agent);
  }
}
