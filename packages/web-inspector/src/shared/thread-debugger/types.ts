export type ThreadDebuggerProviderLoadOptions = {
  signal: AbortSignal;
};

export type ThreadDebuggerToolCall = {
  id: string;
  name: string;
  args: string | Record<string, unknown>;
};

export type ThreadDebuggerMessage = {
  id: string;
  role: string;
  content?: string;
  toolCalls?: ThreadDebuggerToolCall[];
  toolCallId?: string;
  /** Present when role === "activity" (Generative UI output). */
  activityType?: string;
};

export type ThreadDebuggerEvent = {
  type: string;
  timestamp: string | number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ThreadDebuggerMetadata = {
  id: string;
  name?: string | null;
  agentId?: string | null;
  endUserId?: string | null;
  createdById?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ThreadDebuggerProvider = {
  getThreadMetadata?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<ThreadDebuggerMetadata | null>;
  getMessages?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<ThreadDebuggerMessage[]>;
  getEvents?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<ThreadDebuggerEvent[]>;
  getState?: (
    threadId: string,
    options: ThreadDebuggerProviderLoadOptions,
  ) => Promise<Record<string, unknown> | null>;
};
