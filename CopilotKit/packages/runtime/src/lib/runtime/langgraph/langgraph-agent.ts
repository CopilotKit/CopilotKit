import {
  RunAgentInput,
  EventType,
  CustomEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
} from "@ag-ui/client";
import { map } from "rxjs";
import { LangGraphEventTypes } from "../../../agents/langgraph/events";
import { RawEvent } from "@ag-ui/core";
import {
  LangGraphAgent as AGUILangGraphAgent,
  LangGraphHttpAgent,
  type LangGraphAgentConfig,
  ProcessedEvents,
  SchemaKeys,
  type State,
  StateEnrichment,
} from "@ag-ui/langgraph";
import { Message as LangGraphMessage } from "@langchain/langgraph-sdk/dist/types.messages";
import { ThreadState } from "@langchain/langgraph-sdk";

// Utility function to sanitize args for JSON serialization
function sanitizeArgsForSerialization(args: any): any {
  function sanitizeValue(value: any, visited = new WeakSet()): any {
    // Handle null/undefined
    if (value == null) return value;

    // Handle primitives
    if (typeof value !== "object") return value;

    // Handle circular references
    if (visited.has(value)) {
      return null; // or return a placeholder like { __circular: true }
    }
    visited.add(value);

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, visited));
    }

    // Check for HumanMessage using duck typing
    if ("content" in value && value.constructor?.name === "HumanMessage") {
      return {
        type: "HumanMessage",
        content: value.content || "",
        id: value.id || null,
      };
    }

    // Handle regular objects
    const sanitized: any = {};
    for (const prop in value) {
      if (!Object.prototype.hasOwnProperty.call(value, prop)) continue;

      try {
        const propValue = value[prop];
        // Skip functions and symbols
        if (typeof propValue === "function" || typeof propValue === "symbol") {
          continue;
        }

        const sanitizedProp = sanitizeValue(propValue, visited);
        sanitized[prop] = sanitizedProp;
      } catch (e) {
        // Skip properties that can't be processed
        continue;
      }
    }

    return sanitized;
  }

  return sanitizeValue(args);
}

interface CopilotKitStateEnrichment {
  copilotkit: {
    actions: StateEnrichment["ag-ui"]["tools"];
    context: StateEnrichment["ag-ui"]["context"];
  };
}

export interface PredictStateTool {
  tool: string;
  state_key: string;
  tool_argument: string;
}

export type TextMessageEvents =
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent;

export type ToolCallEvents = ToolCallStartEvent | ToolCallArgsEvent | ToolCallEndEvent;

export enum CustomEventNames {
  CopilotKitManuallyEmitMessage = "copilotkit_manually_emit_message",
  CopilotKitManuallyEmitToolCall = "copilotkit_manually_emit_tool_call",
  CopilotKitManuallyEmitIntermediateState = "copilotkit_manually_emit_intermediate_state",
  CopilotKitExit = "copilotkit_exit",
}

export class LangGraphAgent extends AGUILangGraphAgent {
  constructor(config: LangGraphAgentConfig) {
    super(config);
  }

  dispatchEvent(event: ProcessedEvents) {
    if (event.type === EventType.CUSTOM) {
      // const event = processedEvent as unknown as CustomEvent;
      const customEvent = event as unknown as CustomEvent;

      if (customEvent.name === CustomEventNames.CopilotKitManuallyEmitMessage) {
        this.subscriber.next({
          type: EventType.TEXT_MESSAGE_START,
          role: "assistant",
          messageId: customEvent.value.message_id,
          rawEvent: event,
        });
        this.subscriber.next({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: customEvent.value.message_id,
          delta: customEvent.value.message,
          rawEvent: event,
        });
        this.subscriber.next({
          type: EventType.TEXT_MESSAGE_END,
          messageId: customEvent.value.message_id,
          rawEvent: event,
        });
        return true;
      }

      if (customEvent.name === CustomEventNames.CopilotKitManuallyEmitToolCall) {
        this.subscriber.next({
          type: EventType.TOOL_CALL_START,
          toolCallId: customEvent.value.id,
          toolCallName: customEvent.value.name,
          parentMessageId: customEvent.value.id,
          rawEvent: event,
        });
        this.subscriber.next({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: customEvent.value.id,
          delta: sanitizeArgsForSerialization(customEvent.value.args),
          rawEvent: event,
        });
        this.subscriber.next({
          type: EventType.TOOL_CALL_END,
          toolCallId: customEvent.value.id,
          rawEvent: event,
        });
        return true;
      }

      if (customEvent.name === CustomEventNames.CopilotKitManuallyEmitIntermediateState) {
        this.activeRun.manuallyEmittedState = customEvent.value;
        this.dispatchEvent({
          type: EventType.STATE_SNAPSHOT,
          snapshot: this.getStateSnapshot({
            values: this.activeRun.manuallyEmittedState,
          } as ThreadState<State>),
          rawEvent: event,
        });
        return true;
      }

      if (customEvent.name === CustomEventNames.CopilotKitExit) {
        this.subscriber.next({
          type: EventType.CUSTOM,
          name: "Exit",
          value: true,
        });
        return true;
      }
    }

    // Intercept all text message and tool call events and check if should disable
    const rawEvent = (event as ToolCallEvents | TextMessageEvents).rawEvent;
    if (!rawEvent) {
      this.subscriber.next(event);
      return true;
    }

    const isMessageEvent =
      event.type === EventType.TEXT_MESSAGE_START ||
      event.type === EventType.TEXT_MESSAGE_CONTENT ||
      event.type === EventType.TEXT_MESSAGE_END;
    const isToolEvent =
      event.type === EventType.TOOL_CALL_START ||
      event.type === EventType.TOOL_CALL_ARGS ||
      event.type === EventType.TOOL_CALL_END;
    if ("copilotkit:emit-tool-calls" in (rawEvent.metadata || {})) {
      if (rawEvent.metadata["copilotkit:emit-tool-calls"] === false && isToolEvent) {
        return false;
      }
    }
    if ("copilotkit:emit-messages" in (rawEvent.metadata || {})) {
      if (rawEvent.metadata["copilotkit:emit-messages"] === false && isMessageEvent) {
        return false;
      }
    }

    this.subscriber.next(event);
    return true;
  }

  // @ts-ignore
  run(input: RunAgentInput) {
    return super.run(input).pipe(
      map((processedEvent) => {
        // Turn raw event into emit state snapshot from tool call event
        if (processedEvent.type === EventType.RAW) {
          // Get the LangGraph event from the AGUI event.
          const event = (processedEvent as RawEvent).event ?? (processedEvent as RawEvent).rawEvent;

          const eventType = event.event;
          const toolCallData = event.data?.chunk?.tool_call_chunks?.[0];
          const toolCallUsedToPredictState = event.metadata?.[
            "copilotkit:emit-intermediate-state"
          ]?.some(
            (predictStateTool: PredictStateTool) => predictStateTool.tool === toolCallData?.name,
          );

          if (eventType === LangGraphEventTypes.OnChatModelStream && toolCallUsedToPredictState) {
            return {
              type: EventType.CUSTOM,
              name: "PredictState",
              value: event.metadata["copilotkit:emit-intermediate-state"],
            };
          }
        }

        return processedEvent;
      }),
    );
  }

  langGraphDefaultMergeState(
    state: State,
    messages: LangGraphMessage[],
    input: RunAgentInput,
  ): State<StateEnrichment & CopilotKitStateEnrichment> {
    const aguiMergedState = super.langGraphDefaultMergeState(state, messages, input);
    const { tools: returnedTools, "ag-ui": agui } = aguiMergedState;
    // tolerate undefined and de-duplicate by stable key (id | name | key)
    const rawCombinedTools = [
      ...((returnedTools as any[]) ?? []),
      ...((agui?.tools as any[]) ?? []),
    ];
    const combinedTools = Array.from(
      new Map(
        rawCombinedTools.map((t: any) => [t?.id ?? t?.name ?? t?.key ?? JSON.stringify(t), t]),
      ).values(),
    );

    return {
      ...aguiMergedState,
      copilotkit: {
        actions: combinedTools,
        context: agui?.context ?? [],
      },
    };
  }

  async getSchemaKeys(): Promise<SchemaKeys> {
    const CONSTANT_KEYS = ["copilotkit"];
    const schemaKeys = await super.getSchemaKeys();
    return {
      config: schemaKeys.config,
      input: schemaKeys.input ? [...schemaKeys.input, ...CONSTANT_KEYS] : null,
      output: schemaKeys.output ? [...schemaKeys.output, ...CONSTANT_KEYS] : null,
      context: schemaKeys.context ? [...schemaKeys.context, ...CONSTANT_KEYS] : null,
    };
  }
}

export { LangGraphHttpAgent };
