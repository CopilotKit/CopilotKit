import { expressProcessor, messagesOf, surfaceOf } from "../src/agent/express";

export function compileExpress(reply: string, surfaceId: string) {
  const messages = messagesOf(expressProcessor(surfaceId).parseResponse(reply));
  return { messages, ...surfaceOf(messages) };
}
