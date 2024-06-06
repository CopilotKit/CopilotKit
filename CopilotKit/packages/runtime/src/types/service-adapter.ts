export interface CopilotKitResponse {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

export interface CopilotKitServiceAdapterRequest {}

export interface CopilotKitServiceAdapterResponse {
  stream: ReadableStream;
  threadId?: string;
  runId?: string;
}

export interface CopilotKitServiceAdapter {
  getResponse(forwardedProps: any): Promise<CopilotKitResponse>;
}
