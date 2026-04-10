import type { Route } from "./+types/api.copilotkit.$";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
  convertInputToTanStackAI,
  convertMessagesToVercelAISDKMessages,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const tanstackAgent = new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);

    return chat({
      adapter: openaiText("gpt-4o"),
      messages,
      systemPrompts,
      abortController,
    });
  },
});

const aisdkAgent = new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) =>
    streamText({
      model: openai("gpt-4o"),
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      abortSignal,
    }),
});

const runtime = new CopilotRuntime({
  agents: {
    tanstack: tanstackAgent,
    aisdk: aisdkAgent,
  },
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export async function loader({ request }: Route.LoaderArgs) {
  return handler(request);
}

export async function action({ request }: Route.ActionArgs) {
  return handler(request);
}
