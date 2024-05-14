export interface CopilotKitResponse {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

export type OnFinalChatCompletionCallback<T = any> = ((response: T) => void) | null;

export type GetResponseOptions = {
  onFinalChatCompletion?: OnFinalChatCompletionCallback;
};

export interface CopilotKitServiceAdapter {
  getResponse(forwardedProps: any, options: GetResponseOptions): Promise<CopilotKitResponse>;
}
