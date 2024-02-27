export interface CopilotKitServiceAdapterReturnType {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

export interface CopilotKitServiceAdapter {
  stream(
    forwardedProps: any,
  ): Promise<ReadableStream> | Promise<CopilotKitServiceAdapterReturnType>;
}
