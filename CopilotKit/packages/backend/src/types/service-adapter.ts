import { AnnotatedFunction } from "@copilotkit/shared";

export interface CopilotKitServiceAdapter {
  stream(functions: AnnotatedFunction<any[]>[], forwardedProps: any): ReadableStream;
}
