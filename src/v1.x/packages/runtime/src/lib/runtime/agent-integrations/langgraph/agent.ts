import { map, Subscriber } from "rxjs";
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
import { ThreadState, StreamMode } from "@langchain/langgraph-sdk";

// Extract the RunAgentExtendedInput type from the parent class method signature
// since it's not exported from @ag-ui/langgraph
type RunAgentExtendedInput = Parameters<AGUILangGraphAgent["runAgentStream"]>[0];

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
  /**
   * Tracks whether the "events" stream mode is producing on_chat_model_stream events.
   * When true, messages-tuple events are skipped to avoid duplicate streaming.
   */
  private _eventsStreamActive = false;

  /**
   * Tracks the current in-progress message or tool call from messages-tuple events.
   */
  private _messagesTupleTracker: { messageId?: string; toolCallId?: string } = {};

  constructor(config: LangGraphAgentConfig) {
    super(config);
  }

  /**
   * Override to add "messages-tuple" to default stream modes as a fallback for
   * LangGraph Platform deployments where "events" mode doesn't emit streaming data
   * (e.g., graphs built with create_agent from langchain).
   */
  async runAgentStream(input: RunAgentExtendedInput, subscriber: Subscriber<ProcessedEvents>) {
    // Reset per-run state
    this._eventsStreamActive = false;
    this._messagesTupleTracker = {};

    // Add "messages-tuple" as fallback for deployments where "events" mode
    // doesn't emit data (e.g., create_agent on LangGraph Platform)
    if (!input.forwardedProps?.streamMode) {
      (input as any).forwardedProps = {
        ...input.forwardedProps,
        streamMode: ["events", "values", "updates", "messages-tuple"],
      };
    }
    return super.runAgentStream(input, subscriber);
  }

  /**
   * Override to fix a filter mismatch: the "messages-tuple" stream mode produces SSE
   * events with event type "messages", but the parent's filter checks
   * streamModes.includes(event.event). We add "messages" to the filter list so these
   * events pass through to handleSingleEvent.
   */
  async handleStreamEvents(
    stream: Awaited<ReturnType<typeof this.prepareStream>>,
    threadId: string,
    subscriber: Subscriber<ProcessedEvents>,
    input: RunAgentExtendedInput,
    streamModes: StreamMode | StreamMode[],
  ) {
    const modes: StreamMode[] = Array.isArray(streamModes) ? [...streamModes] : [streamModes];
    if (modes.includes("messages-tuple" as StreamMode) && !modes.includes("messages" as StreamMode)) {
      modes.push("messages" as StreamMode);
    }
    return super.handleStreamEvents(stream, threadId, subscriber, input, modes);
  }

  /**
   * Override to detect and route messages-tuple data. The parent calls
   * handleSingleEvent(event.data) where event.data for "messages" events is a
   * [AIMessageChunk, metadata] tuple (an array), not an object with an .event property.
   */
  handleSingleEvent(event: any) {
    // Detect messages-tuple data: it arrives as an array [AIMessageChunk, metadata]
    // Regular events-mode data has event.event (like "on_chat_model_stream")
    if (Array.isArray(event)) {
      if (!this._eventsStreamActive) {
        this.handleMessagesTupleEvent(event);
      }
      return;
    }

    // Track if events-mode streaming is producing data
    if (event.event === "on_chat_model_stream") {
      this._eventsStreamActive = true;
    }

    super.handleSingleEvent(event);
  }

  /**
   * Process [AIMessageChunk, metadata] tuples from messages-tuple stream mode
   * and convert them into AG-UI text message and tool call events.
   */
  private handleMessagesTupleEvent(data: any[]) {
    const chunk = data[0];
    // const metadata = data[1] ?? {};

    // Skip non-AI chunks (e.g., tool result messages, human messages)
    if (chunk.type && chunk.type !== "AIMessageChunk") return;

    const content =
      typeof chunk.content === "string"
        ? chunk.content
        : Array.isArray(chunk.content)
          ? chunk.content.find((c: any) => c.type === "text")?.text
          : null;
    const toolCallChunks = chunk.tool_call_chunks;
    const isFinished = chunk.response_metadata?.finish_reason === "stop";

    // Handle tool call chunks
    if (toolCallChunks?.length > 0) {
      const tc = toolCallChunks[0];
      if (tc.name) {
        // End any text message in progress
        if (this._messagesTupleTracker.messageId && !this._messagesTupleTracker.toolCallId) {
          this.dispatchEvent({
            type: EventType.TEXT_MESSAGE_END,
            messageId: this._messagesTupleTracker.messageId,
          });
        }
        // Start new tool call
        this.dispatchEvent({
          type: EventType.TOOL_CALL_START,
          toolCallId: tc.id || chunk.id,
          toolCallName: tc.name,
          parentMessageId: chunk.id,
        });
        this._messagesTupleTracker = { messageId: chunk.id, toolCallId: tc.id || chunk.id };
        this.activeRun.hasFunctionStreaming = true;
      } else if (tc.args && this._messagesTupleTracker.toolCallId) {
        // Stream tool call args
        this.dispatchEvent({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: this._messagesTupleTracker.toolCallId,
          delta: tc.args,
        });
      }
      return;
    }

    // Handle finish
    if (isFinished) {
      if (this._messagesTupleTracker.toolCallId) {
        this.dispatchEvent({
          type: EventType.TOOL_CALL_END,
          toolCallId: this._messagesTupleTracker.toolCallId,
        });
      } else if (this._messagesTupleTracker.messageId) {
        this.dispatchEvent({
          type: EventType.TEXT_MESSAGE_END,
          messageId: this._messagesTupleTracker.messageId,
        });
      }
      this._messagesTupleTracker = {};
      return;
    }

    // Skip empty initialization chunks
    if (!content && !toolCallChunks?.length) return;

    // Handle text content streaming
    if (content) {
      if (!this._messagesTupleTracker.messageId) {
        this.dispatchEvent({
          type: EventType.TEXT_MESSAGE_START,
          role: "assistant",
          messageId: chunk.id,
        });
        this._messagesTupleTracker = { messageId: chunk.id };
      }
      this.dispatchEvent({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: this._messagesTupleTracker.messageId,
        delta: content,
      });
    }
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
          delta: customEvent.value.args,
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
