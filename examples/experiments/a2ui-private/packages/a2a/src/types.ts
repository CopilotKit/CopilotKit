import type {
  MessageSendConfiguration,
  MessageSendParams,
  Message as A2AMessage,
  Part as A2APart,
  TextPart as A2ATextPart,
  DataPart as A2ADataPart,
  FilePart as A2AFilePart,
  Task as A2ATask,
  TaskStatusUpdateEvent as A2ATaskStatusUpdateEvent,
  TaskArtifactUpdateEvent as A2ATaskArtifactUpdateEvent,
} from "@a2a-js/sdk";
import type { Message as AGUIMessage } from "@ag-ui/client";

export type {
  A2AMessage,
  A2APart,
  A2ATextPart,
  A2ADataPart,
  A2AFilePart,
  MessageSendParams,
  MessageSendConfiguration,
  AGUIMessage as AGUIConversationMessage,
};

export interface SurfaceTracker {
  has(surfaceId: string): boolean;
  add(surfaceId: string): void;
}

export type A2AStreamEvent =
  | A2AMessage
  | A2ATask
  | A2ATaskStatusUpdateEvent
  | A2ATaskArtifactUpdateEvent;

export interface ConvertAGUIMessagesOptions {
  contextId?: string;
  includeToolMessages?: boolean;
}

export interface ConvertedA2AMessages {
  contextId?: string;
  history: A2AMessage[];
  latestUserMessage?: A2AMessage;
}

export interface ConvertA2AEventOptions {
  role?: "assistant" | "user";
  messageIdMap: Map<string, string>;
  onTextDelta?: (payload: { messageId: string; delta: string }) => void;
  source?: string;
  getCurrentText?: (messageId: string) => string | undefined;
  surfaceTracker?: SurfaceTracker;
}

export interface A2AAgentRunResultSummary {
  messages: Array<{ messageId: string; text: string }>;
  rawEvents: A2AStreamEvent[];
}
