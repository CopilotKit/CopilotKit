import {
  BaseEvent,
  EventType,
  RunAgentInput,
  StateSnapshotEvent,
  TextMessageChunkEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
  ToolCallChunkEvent,
  CustomEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";

// WebhookEvent interface exactly matches the CrewAI webhook format
interface WebhookEvent {
  timestamp: string;
  id: string;
  execution_id: string;
  type: string;
  data: any;
  event_type: string;
}

const shouldBailOutIfToolCall = (event: WebhookEvent, input: RunAgentInput) => {
  return (
    input.tools.length > 0 &&
    ["copilotkit_frontend_tool_call", "tool_usage_finished"].includes(
      event.type
    ) &&
    input.tools.map((tool) => tool.name).includes(event.data.tool_name)
  );
};

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 5
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      if (attempt === maxRetries) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`Retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`Retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries exceeded");
}

// This version of pollWebhookEvents is for testing the AG-UI client's handling of a basic message sequence.
// It assumes the calling framework (e.g., AbstractAgent) handles RUN_STARTED and RUN_FINISHED.
export function pollWebhookEvents(
  webhookUrl: string,
  messageIdToUse: string,
  input: RunAgentInput
): Observable<BaseEvent> {
  console.log("pollWebhookEvents", webhookUrl);
  return new Observable<BaseEvent>((subscriber) => {
    const processedEventIds = new Set<string>();
    let isCompleted = false;

    const poll = async () => {
      if (isCompleted) return;

      try {
        const response = await fetchWithRetry(webhookUrl, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
          console.error(`Webhook fetch error: ${response.status}`);
          return;
        }

        const data = await response.json();
        const allEvents: WebhookEvent[] = [];

        // ✅ FIRST: Collect ALL events without checking completion
        Object.keys(data).forEach((eventType) => {
          if (Array.isArray(data[eventType])) {
            data[eventType].forEach((e: WebhookEvent) => {
              allEvents.push({ ...e, event_type: eventType });
            });
          }
        });

        // Filter new events
        const newEvents = allEvents
          .filter((event) => !processedEventIds.has(event.id))
          .sort(sortEventsByTimestamp);

        // Track processed events
        newEvents.forEach((event) => processedEventIds.add(event.id));

        // ✅ SECOND: Process ALL events (including debounced_chunk)
        if (newEvents.length > 0) {
          const agEvents = createAllEvents(newEvents, messageIdToUse, input);
          agEvents.forEach((event) => {
            subscriber.next(event);
          });
        }

        // ✅ THIRD: Check completion AFTER processing all events
        const shouldComplete = newEvents.some(
          (event) =>
            event.event_type === "flow_finished" ||
            ["copilotkit_frontend_tool_call", "tool_usage_finished"].includes(
              event.type
            )
        );

        if (shouldComplete) {
          console.log("[Webhook Poll] Completing stream", webhookUrl);
          isCompleted = true;
          subscriber.complete();
          return;
        }

        // Schedule next poll
        setTimeout(poll, 1000);
      } catch (error) {
        console.error(`Error in webhook polling:`, error);
        setTimeout(poll, 1000);
      }
    };

    poll();

    return () => {
      isCompleted = true;
    };
  });
}

// Consolidated event creation logic for readability and maintainability
function createAllEvents(
  events: WebhookEvent[],
  messageIdToUse: string,
  input: RunAgentInput
): BaseEvent[] {
  const agEvents: BaseEvent[] = [];
  const frontendTools = input.tools;

  for (const event of events) {
    let numericTimestamp = new Date(event.timestamp).getTime();
    if (isNaN(numericTimestamp)) {
      numericTimestamp = Date.now();
    }

    const shouldCallFrontendTool =
      frontendTools.length > 0 &&
      // CrewAI treats this frontend tools as tool calls
      ["copilotkit_frontend_tool_call", "tool_usage_finished"].includes(
        event.type
      ) &&
      frontendTools.map((tool) => tool.name).includes(event.data.tool_name);

    // Mapping based on CrewAI event type
    switch (event.type) {
      case "copilotkit_predict_state":
        const predictStateConfig = event.data["predict_config"];
        if (predictStateConfig) {
          agEvents.push({
            type: EventType.CUSTOM,
            name: "PredictState",
            value: predictStateConfig,
          } as CustomEvent);
        }
        break;
      case "tool_usage_finished":
      case "copilotkit_frontend_tool_call":
        if (shouldCallFrontendTool) {
          const toolCallId = event.execution_id;
          agEvents.push({
            type: EventType.TOOL_CALL_START,
            toolCallId,
            toolCallName: event.data.tool_name,
            timestamp: numericTimestamp + 100,
          } as ToolCallStartEvent);
          agEvents.push({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId,
            delta: JSON.stringify(event.data.tool_args || event.data.args),
            timestamp: numericTimestamp + 200,
          } as ToolCallArgsEvent);
          agEvents.push({
            type: EventType.TOOL_CALL_END,
            toolCallId,
            timestamp: numericTimestamp + 300,
          } as ToolCallEndEvent);
        }
        break;
      case "copilotkit_state_update":
        console.log("copilotkit_state_update", event);
        agEvents.push({
          type: EventType.STATE_SNAPSHOT,
          timestamp: numericTimestamp,
          rawEvent: event,
          snapshot: {
            id: input.state?.id || event.execution_id,
            timestamp: numericTimestamp,
            source: "crew-flow-state-update",
            data: event.data.args,
          },
        } as StateSnapshotEvent);
        break;
      case "debounced_llm_stream_chunk": {
        agEvents.push({
          type: EventType.TOOL_CALL_CHUNK,
          toolCallId: event.execution_id,
          timestamp: numericTimestamp,
          delta: event.data.chunk ?? "",
          toolCallName: event.data.context,
          rawEvent: event,
        } as ToolCallChunkEvent);
        break;
      }
      case "flow_finished":
        const shouldHandleToolAnyToolCall = events.some((event) =>
          shouldBailOutIfToolCall(event, input)
        );

        if (event.data?.result && !shouldHandleToolAnyToolCall) {
          agEvents.push({
            type: EventType.TEXT_MESSAGE_CHUNK,
            messageId: messageIdToUse,
            role: "assistant",
            delta: event.data.result,
            rawEvent: event,
          } as TextMessageChunkEvent);
        }
        break;
      default:
        break;
    }
  }
  return agEvents;
}

function sortEventsByTimestamp(eventA: WebhookEvent, eventB: WebhookEvent) {
  const timeA = new Date(eventA.timestamp).getTime();
  const timeB = new Date(eventB.timestamp).getTime();
  const aIsNaN = isNaN(timeA);
  const bIsNaN = isNaN(timeB);
  if (aIsNaN && bIsNaN) return 0;
  if (aIsNaN) return 1;
  if (bIsNaN) return -1;
  return timeA - timeB;
}
