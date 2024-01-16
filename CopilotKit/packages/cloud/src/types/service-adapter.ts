export interface CopilotKitServiceAdapter {
  stream(forwardedProps: any): ReadableStream;
}

export type CopilotKitOpenAIConfiguration = {
  provider?: "openai"; // default to openai
  apiKey?: string;
  model?: string;
};
