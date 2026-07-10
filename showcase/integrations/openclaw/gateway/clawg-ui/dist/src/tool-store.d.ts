import type { EventType } from "@ag-ui/core";
export type EventWriter = (
  event: {
    type: EventType;
  } & Record<string, unknown>,
) => void;
export declare function setWriter(
  sessionKey: string,
  writer: EventWriter,
  messageId: string,
): void;
export declare function getWriter(sessionKey: string): EventWriter | undefined;
export declare function getMessageId(sessionKey: string): string | undefined;
export declare function clearWriter(sessionKey: string): void;
export declare function pushToolCallId(
  sessionKey: string,
  toolCallId: string,
): void;
export declare function popToolCallId(sessionKey: string): string | undefined;
export declare function markClientToolNames(
  sessionKey: string,
  names: string[],
): void;
export declare function isClientTool(
  sessionKey: string,
  toolName: string,
): boolean;
export declare function clearClientToolNames(sessionKey: string): void;
export declare function setClientToolCalled(sessionKey: string): void;
export declare function wasClientToolCalled(sessionKey: string): boolean;
export declare function clearClientToolCalled(sessionKey: string): void;
