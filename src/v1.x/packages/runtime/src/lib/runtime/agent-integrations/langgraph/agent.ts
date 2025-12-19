import { map } from "rxjs";
import { LangGraphEventTypes } from "../../../../agents/langgraph/events";
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

interface CopilotKitStateEnrichment {
  copilotkit: {
    actions: StateEnrichment["ag-ui"]["tools"];
    context: StateEnrichment["ag-ui"]["context"];
  };
}

import { RunAgentInput, EventType, CustomEvent } from "@ag-ui/client";

// Import and re-export from separate file to maintain API compatibility
import { CustomEventNames, TextMessageEvents, ToolCallEvents, PredictStateTool } from "./consts";
export { CustomEventNames };

export class LangGraphAgent extends AGUILangGraphAgent {
  // Some event sources (especially streaming tool call chunks / custom events) may omit
  // tool call identifiers or names on subsequent deltas. We normalize them here so
  // downstream schema validation never sees `undefined`.
  private _lastToolCallId: string | null = null;
  private _toolCallNameById = new Map<string, string>();

  constructor(config: LangGraphAgentConfig) {
    super(config);
  }

  private _newToolCallId(): string {
    // Prefer Web Crypto UUID when available (works in Node 20+/modern runtimes),
    // otherwise fall back to a stable-enough unique string.
    const g: any = globalThis as any;
    const uuid = g?.crypto?.randomUUID?.();
    return typeof uuid === "string" && uuid.length > 0
      ? uuid
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private _getToolCallChunk(rawEvent: any): any | null {
    // @ag-ui/core RawEvent can wrap the original event in different keys depending on source.
    const ev = rawEvent?.event ?? rawEvent?.rawEvent ?? rawEvent;
    return ev?.data?.chunk?.tool_call_chunks?.[0] ?? null;
  }

  private _ensureToolCallId(candidate: any, rawEvent: any): string {
    const chunk = this._getToolCallChunk(rawEvent);
    const id = candidate ?? chunk?.id ?? this._lastToolCallId ?? this._newToolCallId();
    const idStr = String(id);
    this._lastToolCallId = idStr;
    return idStr;
  }

  private _ensureToolCallName(candidate: any, toolCallId: string, rawEvent: any): string {
    const chunk = this._getToolCallChunk(rawEvent);
    const name = candidate ?? chunk?.name ?? this._toolCallNameById.get(toolCallId) ?? "tool";
    const nameStr = String(name);
    if (nameStr) {
      this._toolCallNameById.set(toolCallId, nameStr);
    }
    return nameStr;
  }

  private _ensureArgsDelta(value: any): string {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  // @ts-ignore
  public clone() {
    return new LangGraphAgent(this.config);
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
        const toolCallId = this._ensureToolCallId(
          customEvent.value?.id ?? customEvent.value?.toolCallId ?? customEvent.value?.tool_call_id,
          event,
        );
        const toolCallName = this._ensureToolCallName(
          customEvent.value?.name ??
            customEvent.value?.toolCallName ??
            customEvent.value?.tool_call_name ??
            customEvent.value?.actionName,
          toolCallId,
          event,
        );
        const delta = this._ensureArgsDelta(
          customEvent.value?.args ?? customEvent.value?.arguments,
        );
        const parentMessageId = (customEvent.value?.parentMessageId ?? toolCallId) as string;

        this.subscriber.next({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName,
          parentMessageId,
          rawEvent: event,
        });
        this.subscriber.next({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta,
          rawEvent: event,
        });
        this.subscriber.next({
          type: EventType.TOOL_CALL_END,
          toolCallId,
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

    if (isToolEvent) {
      // Normalize tool call events coming from upstream (@ag-ui/langgraph) to avoid
      // `toolCallId/toolCallName` being undefined in streaming scenarios.
      const e: any = { ...(event as any) };
      e.toolCallId = this._ensureToolCallId(e.toolCallId, rawEvent);

      if (e.type === EventType.TOOL_CALL_START) {
        e.toolCallName = this._ensureToolCallName(e.toolCallName, e.toolCallId, rawEvent);
        e.parentMessageId = e.parentMessageId ?? e.toolCallId;
      }

      if (e.type === EventType.TOOL_CALL_ARGS) {
        e.delta = this._ensureArgsDelta(e.delta);
      }

      this.subscriber.next(e);
      return true;
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
