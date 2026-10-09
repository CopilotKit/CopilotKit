import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  Message as AguiMessage,
  RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { asSchema } from "ai";
import type { FlexibleSchema } from "ai";
import { randomUUID } from "@copilotkit/shared";
import type * as SharedAgui from "@copilotkit/shared";
import type { BuiltInAgentClassicConfig } from "../../../agent";
import type { CopilotServiceAdapter } from "../../service-adapters/service-adapter";
import {
  RuntimeEventSubject,
  RuntimeEventTypes,
} from "../../service-adapters/events";
import type {
  RuntimeEvent,
  RuntimeEventSource,
} from "../../service-adapters/events";
import { aguiToGQL } from "../../graphql/message-conversion/agui-to-gql";
import type { ActionInput } from "../../graphql/inputs/action.input";

/** Matches BuiltInAgent's default `stepCountIs(10)`. */
const MAX_STEPS = 10;

/** Roles `aguiToGQL` converts. Anything else (e.g. `activity`) has no v1 form. */
const V1_ROLES = new Set(["developer", "system", "assistant", "user", "tool"]);

type ServerTool = NonNullable<BuiltInAgentClassicConfig["tools"]>[number];

interface StepToolCall {
  id: string;
  name: string;
  args: string;
}

interface StepResult {
  text: string;
  textMessageId?: string;
  toolCalls: StepToolCall[];
  results: { toolCallId: string; content: string }[];
}

/**
 * Runs a v1 `CopilotServiceAdapter` through its own `process()` method.
 *
 * Since v1.50.0 the runtime turned a service adapter into a `BuiltInAgent`,
 * which only works when the adapter can name a model. An adapter whose value
 * lives in `process()` -- `LangChainAdapter`'s `chainFn` above all -- had no
 * path to execution at all (#3217). This agent is that path: it converts the
 * AG-UI input to the v1 request shape, calls `process()`, and maps the
 * adapter's runtime events back to AG-UI events.
 *
 * Server-side v1 `actions` and `mcpServers` reach it the same way they reach
 * `BuiltInAgent`, as `config.tools`. They are advertised to the adapter
 * alongside the frontend tools, and executed here when the model calls them,
 * which is what the v1 runtime did before v1.50.0.
 */
export class LegacyServiceAdapterAgent extends AbstractAgent {
  /** Written by `assignToolsToAgents`, the same as on `BuiltInAgent`. */
  config: { tools?: BuiltInAgentClassicConfig["tools"] } = {};

  private abortController?: AbortController;

  constructor(private readonly serviceAdapter: CopilotServiceAdapter) {
    super();
  }

  clone(): LegacyServiceAdapterAgent {
    const cloned = super.clone() as LegacyServiceAdapterAgent;
    Reflect.set(cloned, "serviceAdapter", this.serviceAdapter);
    cloned.config = { ...this.config };
    return cloned;
  }

  /**
   * Stops the current run, which is what the runner calls when the user
   * presses Stop. The adapter's in-flight stream is abandoned, no further
   * `process()` step or server-side tool runs, and the run completes without
   * a terminal event, the same as `BuiltInAgent`.
   */
  abortRun(): void {
    this.abortController?.abort();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const controller = new AbortController();
      this.abortController = controller;
      const { signal } = controller;
      const emit = (event: BaseEvent) => {
        if (!signal.aborted) subscriber.next(event);
      };
      const release = () => {
        if (this.abortController === controller) {
          this.abortController = undefined;
        }
      };

      this.execute(input, emit, signal).then(
        () => {
          release();
          if (signal.aborted) {
            subscriber.complete();
            return;
          }
          emit({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          } as BaseEvent);
          subscriber.complete();
        },
        (error: unknown) => {
          release();
          if (signal.aborted) {
            subscriber.complete();
            return;
          }
          emit({
            type: EventType.RUN_ERROR,
            message: error instanceof Error ? error.message : String(error),
          } as BaseEvent);
          subscriber.error(error);
        },
      );

      return () => {
        controller.abort();
        release();
      };
    });
  }

  private async execute(
    input: RunAgentInput,
    emit: (event: BaseEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    emit({
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    } as BaseEvent);

    const frontendNames = new Set(input.tools.map((tool) => tool.name));
    const serverTools = new Map<string, ServerTool>();
    for (const tool of this.config.tools ?? []) {
      // A frontend tool of the same name wins, as it does on BuiltInAgent.
      if (tool.execute && !frontendNames.has(tool.name)) {
        serverTools.set(tool.name, tool);
      }
    }

    const actions = [
      ...input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        jsonSchema: JSON.stringify(
          tool.parameters ?? { type: "object", properties: {} },
        ),
      })),
      ...(await Promise.all(
        [...serverTools.values()].map(async (tool) => ({
          name: tool.name,
          description: tool.description ?? "",
          // v1 actions and MCP tools arrive here with Zod parameters; the AI
          // SDK is what converts those for BuiltInAgent too.
          jsonSchema: JSON.stringify(
            await asSchema(tool.parameters as FlexibleSchema<unknown>)
              .jsonSchema,
          ),
        })),
      )),
    ] as ActionInput[];

    const messages: AguiMessage[] = [];
    if (input.context?.length) {
      // The v1 frontend folded readable context into the system message. The
      // v2 frontend sends it separately, so put it back where the adapter
      // expects it.
      messages.push({
        id: randomUUID(),
        role: "system",
        content:
          "## Context from the application\n" +
          input.context
            .map((ctx) => `${ctx.description}:\n${ctx.value}\n`)
            .join(""),
      });
    }
    messages.push(
      ...input.messages.filter((message) => V1_ROLES.has(message.role)),
    );

    for (let step = 0; step < MAX_STEPS; step++) {
      const result = await this.runStep(input, messages, actions, emit, signal);
      if (signal.aborted) return;

      const answered = new Set(result.results.map((r) => r.toolCallId));
      const pending = result.toolCalls.filter((call) => !answered.has(call.id));
      const serverCalls = pending.filter((call) => serverTools.has(call.name));

      if (result.text || result.toolCalls.length) {
        messages.push({
          id: result.textMessageId ?? randomUUID(),
          role: "assistant",
          content: result.text,
          ...(result.toolCalls.length && {
            toolCalls: result.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.args || "{}" },
            })),
          }),
        });
      }
      for (const { toolCallId, content } of result.results) {
        messages.push({ id: randomUUID(), role: "tool", toolCallId, content });
      }

      for (const call of serverCalls) {
        if (signal.aborted) return;
        const content = await this.executeServerTool(
          serverTools.get(call.name)!,
          call,
        );
        emit({
          type: EventType.TOOL_CALL_RESULT,
          messageId: randomUUID(),
          toolCallId: call.id,
          content,
        } as BaseEvent);
        messages.push({
          id: randomUUID(),
          role: "tool",
          toolCallId: call.id,
          content,
        });
      }

      // Another step only makes sense when every open call has a result. A
      // frontend tool call ends the run; the client executes it and starts
      // the next one.
      if (!serverCalls.length || serverCalls.length !== pending.length) {
        return;
      }
    }
  }

  private async executeServerTool(
    tool: ServerTool,
    call: StepToolCall,
  ): Promise<string> {
    let args: unknown = {};
    try {
      args = call.args ? JSON.parse(call.args) : {};
    } catch {
      return `The tool "${call.name}" received arguments that are not valid JSON.`;
    }
    try {
      const output = await tool.execute!(args as never);
      return typeof output === "string" ? output : JSON.stringify(output ?? "");
    } catch (error) {
      return JSON.stringify({
        error: {
          code: "ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
        result: "",
      });
    }
  }

  /** One call to `process()`, with its runtime events forwarded as AG-UI. */
  private async runStep(
    input: RunAgentInput,
    messages: AguiMessage[],
    actions: ActionInput[],
    emit: (event: BaseEvent) => void,
    signal: AbortSignal,
  ): Promise<StepResult> {
    let streamCallback:
      | ((eventStream$: RuntimeEventSubject) => Promise<void>)
      | undefined;
    // `RuntimeEventSource.stream` only stores the callback; the code that
    // consumed it was deleted in v1.50.0. Capture it and consume it here.
    const eventSource = {
      stream: async (
        callback: (eventStream$: RuntimeEventSubject) => Promise<void>,
      ) => {
        streamCallback = callback;
      },
    } as unknown as RuntimeEventSource;

    await this.serviceAdapter.process({
      eventSource,
      messages: aguiToGQL(messages as SharedAgui.Message[]),
      actions,
      threadId: input.threadId,
      runId: input.runId,
    });

    const result: StepResult = { text: "", toolCalls: [], results: [] };
    if (!streamCallback || signal.aborted) {
      return result;
    }

    const subject = new RuntimeEventSubject();
    const done = new Promise<void>((resolve, reject) => {
      subject.subscribe({
        next: (event) => {
          try {
            this.forward(event, result, emit);
          } catch (error) {
            reject(error);
          }
        },
        error: reject,
        complete: resolve,
      });
      // Nothing can cancel an adapter's stream from outside, so on abort stop
      // waiting for it; `emit` already drops anything it sends afterwards.
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    // An adapter that returns without completing its stream is finished too.
    streamCallback(subject).then(
      () => subject.complete(),
      (error) => subject.error(error),
    );
    await done;
    return result;
  }

  private forward(
    event: RuntimeEvent,
    step: StepResult,
    emit: (event: BaseEvent) => void,
  ): void {
    switch (event.type) {
      case RuntimeEventTypes.TextMessageStart:
        step.textMessageId ??= event.messageId;
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId: event.messageId,
          role: "assistant",
        } as BaseEvent);
        return;
      case RuntimeEventTypes.TextMessageContent:
        // AG-UI rejects an empty delta.
        if (!event.content) return;
        step.text += event.content;
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: event.messageId,
          delta: event.content,
        } as BaseEvent);
        return;
      case RuntimeEventTypes.TextMessageEnd:
        emit({
          type: EventType.TEXT_MESSAGE_END,
          messageId: event.messageId,
        } as BaseEvent);
        return;
      case RuntimeEventTypes.ActionExecutionStart:
        step.toolCalls.push({
          id: event.actionExecutionId,
          name: event.actionName,
          args: "",
        });
        emit({
          type: EventType.TOOL_CALL_START,
          toolCallId: event.actionExecutionId,
          toolCallName: event.actionName,
          parentMessageId: event.parentMessageId,
        } as BaseEvent);
        return;
      case RuntimeEventTypes.ActionExecutionArgs: {
        if (!event.args) return;
        const call = step.toolCalls.find(
          (c) => c.id === event.actionExecutionId,
        );
        if (call) call.args += event.args;
        emit({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: event.actionExecutionId,
          delta: event.args,
        } as BaseEvent);
        return;
      }
      case RuntimeEventTypes.ActionExecutionEnd:
        emit({
          type: EventType.TOOL_CALL_END,
          toolCallId: event.actionExecutionId,
        } as BaseEvent);
        return;
      case RuntimeEventTypes.ActionExecutionResult:
        step.results.push({
          toolCallId: event.actionExecutionId,
          content: event.result,
        });
        emit({
          type: EventType.TOOL_CALL_RESULT,
          messageId: randomUUID(),
          toolCallId: event.actionExecutionId,
          content: event.result,
        } as BaseEvent);
        return;
      case RuntimeEventTypes.RunError:
        throw new Error(event.message);
      default:
        // Agent-state and LangGraph meta events came only from remote agent
        // endpoints, which do not run through a service adapter.
        return;
    }
  }
}
