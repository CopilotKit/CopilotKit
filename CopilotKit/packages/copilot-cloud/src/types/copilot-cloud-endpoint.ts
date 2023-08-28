export interface MessageProtocol {
  id: string;
  content: string;
}

export type Params = {
  [key: string]: any;
}

export type CopilotCloudEndpoint = {
  // (input: { messages: MessageProtocol[]; params: Params }): Promise<AsyncIterable<string>>;
}
