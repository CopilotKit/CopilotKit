export interface CopilotKitServiceAdapterReturnType {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

export interface CopilotKitServiceAdapter {
  stream(
    forwardedProps: any,
  ):
    | ReadableStream
    | Promise<ReadableStream>
    | CopilotKitServiceAdapterReturnType
    | Promise<CopilotKitServiceAdapterReturnType>;
}
