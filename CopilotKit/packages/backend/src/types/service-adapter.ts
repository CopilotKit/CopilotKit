export interface CopilotKitServiceAdapter {
  stream(forwardedProps: any): ReadableStream | Promise<ReadableStream>;
}
