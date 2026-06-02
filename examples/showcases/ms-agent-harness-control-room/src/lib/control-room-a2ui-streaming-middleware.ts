import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
  ToolCallArgsEvent,
  ToolCallStartEvent,
} from "@ag-ui/client";
import { EventType, Middleware } from "@ag-ui/client";
import { Observable } from "rxjs";

import {
  CONTROL_ROOM_A2UI_CATALOG_ID,
  controlRoomA2UISchema,
} from "@/lib/control-room-a2ui-definitions";

const A2UI_ACTIVITY_TYPE = "a2ui-surface";
const A2UI_OPERATIONS_KEY = "a2ui_operations";
const A2UI_SCHEMA_CONTEXT_DESCRIPTION =
  "A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.";
const CONTROL_ROOM_A2UI_TOOL_NAME = "render_control_room_a2ui";
const LOG_A2UI_EVENT_TOOL_NAME = "log_a2ui_event";

type A2UIArgs = {
  surfaceId?: string;
  catalogId?: string;
  components?: Array<Record<string, unknown>>;
};

type A2UIStreamState = {
  args: string;
  emittedComponents: number;
};

export class ControlRoomA2UIStreamingMiddleware extends Middleware {
  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const activeA2UITools = new Map<string, A2UIStreamState>();
      const nextInput = injectSchemaContext(processUserAction(input));

      const subscription = this.runNext(nextInput, next).subscribe({
        next: (event) => {
          if (event.type === EventType.TOOL_CALL_START) {
            const toolStart = event as ToolCallStartEvent;
            if (toolStart.toolCallName === CONTROL_ROOM_A2UI_TOOL_NAME) {
              activeA2UITools.set(toolStart.toolCallId, {
                args: "",
                emittedComponents: 0,
              });
              subscriber.next(createLoadingSnapshot(toolStart.toolCallId));
            }
          }

          if (event.type === EventType.TOOL_CALL_ARGS) {
            const argsEvent = event as ToolCallArgsEvent;
            const streamState = activeA2UITools.get(argsEvent.toolCallId);
            if (streamState) {
              streamState.args += argsEvent.delta;
              const parsed = parseA2UIArgs(streamState.args);
              const components = parsed.components ?? [];
              if (components.length > streamState.emittedComponents) {
                streamState.emittedComponents = components.length;
                subscriber.next(
                  createSurfaceSnapshot(argsEvent.toolCallId, parsed),
                );
              }
            }
          }

          subscriber.next(event);
        },
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      return () => subscription.unsubscribe();
    });
  }
}

function injectSchemaContext(input: RunAgentInput): RunAgentInput {
  const nextContext = (input.context ?? []).filter(
    (entry) => entry.description !== A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  );

  nextContext.push({
    description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
    value: JSON.stringify(controlRoomA2UISchema),
  });

  return {
    ...input,
    context: nextContext,
  };
}

function processUserAction(input: RunAgentInput): RunAgentInput {
  const action = (input.forwardedProps as any)?.a2uiAction?.userAction;
  if (!action) {
    return input;
  }

  const toolCallId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const toolResultMessageId = crypto.randomUUID();
  const nextMessages: Message[] = [
    ...(input.messages ?? []),
    {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: toolCallId,
          type: "function",
          function: {
            name: LOG_A2UI_EVENT_TOOL_NAME,
            arguments: JSON.stringify(action),
          },
        },
      ],
    } as Message,
    {
      id: toolResultMessageId,
      role: "tool",
      toolCallId,
      content: formatUserActionResult(action),
    } as Message,
  ];

  return {
    ...input,
    messages: nextMessages,
  };
}

function formatUserActionResult(action: Record<string, unknown>) {
  const name = readString(action.name) ?? "unknown_action";
  const surfaceId = readString(action.surfaceId) ?? "unknown_surface";
  const componentId = readString(action.sourceComponentId);
  const context =
    action.context && typeof action.context === "object"
      ? JSON.stringify(action.context)
      : "{}";

  return [
    `User performed action "${name}" on surface "${surfaceId}"`,
    componentId ? ` (component: ${componentId})` : "",
    `. Context: ${context}`,
  ].join("");
}

function createLoadingSnapshot(toolCallId: string): BaseEvent {
  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: getActivityMessageId(toolCallId),
    activityType: A2UI_ACTIVITY_TYPE,
    content: {},
    replace: true,
  } as BaseEvent;
}

function createSurfaceSnapshot(toolCallId: string, args: A2UIArgs): BaseEvent {
  const surfaceId = args.surfaceId || `control-room-a2ui-${toolCallId}`;
  const catalogId = args.catalogId || CONTROL_ROOM_A2UI_CATALOG_ID;
  const components = args.components ?? [];

  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: getActivityMessageId(toolCallId),
    activityType: A2UI_ACTIVITY_TYPE,
    content: {
      [A2UI_OPERATIONS_KEY]: [
        {
          version: "v0.9",
          createSurface: {
            surfaceId,
            catalogId,
          },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId,
            components,
          },
        },
      ],
    },
    replace: true,
  } as BaseEvent;
}

function getActivityMessageId(toolCallId: string) {
  return `control-room-a2ui-${toolCallId}`;
}

function parseA2UIArgs(partialJson: string): A2UIArgs {
  const completeArgs = tryParseObject(partialJson);
  if (completeArgs) {
    return {
      surfaceId: readString(completeArgs.surfaceId),
      catalogId: readString(completeArgs.catalogId),
      components: readComponents(completeArgs.components),
    };
  }

  return {
    surfaceId: extractStringField(partialJson, "surfaceId") ?? undefined,
    catalogId: extractStringField(partialJson, "catalogId") ?? undefined,
    components: extractCompleteArray(partialJson, "components"),
  };
}

function tryParseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readComponents(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (component): component is Record<string, unknown> =>
      !!component && typeof component === "object" && !Array.isArray(component),
  );
}

function extractStringField(partialJson: string, key: string): string | null {
  const pattern = new RegExp(
    `"${escapeRegExp(key)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`,
  );
  const match = partialJson.match(pattern);
  if (!match) return null;

  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return null;
  }
}

function extractCompleteArray(
  partialJson: string,
  key: string,
): Array<Record<string, unknown>> {
  const keyIndex = partialJson.indexOf(`"${key}"`);
  if (keyIndex === -1) return [];

  const start = partialJson.indexOf("[", keyIndex);
  if (start === -1) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastCompleteElementEnd = -1;

  for (let index = start; index < partialJson.length; index++) {
    const char = partialJson[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "[" || char === "{") {
      depth += 1;
      continue;
    }

    if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 1 && char === "}") {
        lastCompleteElementEnd = index + 1;
      }
      if (depth === 0 && char === "]") {
        lastCompleteElementEnd = index;
        break;
      }
    }
  }

  if (lastCompleteElementEnd === -1) return [];

  const rawArray = `${partialJson.slice(start, lastCompleteElementEnd)}]`;
  try {
    return readComponents(JSON.parse(rawArray));
  } catch {
    return [];
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
