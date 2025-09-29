export interface CopilotErrorEvent {
  type: "error" | "request" | "response" | "agent_state" | "action" | "message" | "performance";
  timestamp: number;
  context: CopilotRequestContext;
  error?: any; // Present when type is 'error'
}

export interface CopilotRequestContext {
  // Basic identifiers
  threadId?: string;
  runId?: string;
  source: "runtime" | "ui" | "agent" | "network";

  // Request details
  request?: {
    operation: string;
    method?: string;
    url?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: any;
    startTime: number;
  };

  // Response details
  response?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: any;
    endTime: number;
    latency: number;
  };

  // Agent context
  agent?: {
    name?: string;
    nodeName?: string;
    state?: any;
  };

  // Message flow context
  messages?: {
    input?: any[];
    output?: any[];
    messageCount?: number;
  };

  // Technical context
  technical?: {
    userAgent?: string;
    host?: string;
    environment?: string;
    version?: string;
    stackTrace?: string;
  };

  // Performance metrics
  performance?: {
    requestDuration?: number;
    streamingDuration?: number;
    actionExecutionTime?: number;
    memoryUsage?: number;
  };

  // Extensible metadata
  metadata?: Record<string, any>;
}

export type CopilotErrorHandler = (errorEvent: CopilotErrorEvent) => void | Promise<void>;
