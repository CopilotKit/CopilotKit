export interface CopilotKitResponse {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

export interface CopilotKitServiceAdapter {
  getResponse(forwardedProps: any): Promise<CopilotKitResponse>;
}
