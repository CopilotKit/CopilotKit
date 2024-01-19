import { AnnotatedFunction } from "@copilotkit/shared";

export interface CopilotKitServiceAdapter {
  stream(functions: AnnotatedFunction<any[]>[], forwardedProps: any): ReadableStream;
}

export type CopilotKitOpenAIConfiguration = {
  provider?: "openai"; // default to openai
  apiKey?: string;
  model?: string;
  functions?: AnnotatedFunction<any[]>[];
};
