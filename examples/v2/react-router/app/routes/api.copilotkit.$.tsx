import type { Route } from "./+types/api.copilotkit.$";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
  convertInputToTanStackAI,
  convertMessagesToVercelAISDKMessages,
} from "@copilotkit/runtime/v2";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { streamText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

// A flight-booking tool the model can call. It carries each SDK's NATIVE
// human-in-the-loop flag (`needsApproval`) and has NO executor — so calling it
// pauses the run for human approval instead of running server code. The
// CopilotKit runtime turns that native pause into an AG-UI standard interrupt
// (RUN_FINISHED outcome:interrupt) that `useInterrupt` renders, and injects the
// human's response as the tool's result on resume. Identical UX in both SDKs.
const bookFlightInput = z.object({
  destination: z.string().describe("Destination city"),
  date: z.string().describe("Travel date, if mentioned").optional(),
});

const BOOKING_SYSTEM_PROMPT =
  "You are a travel assistant. When the user asks to book one or more flights, " +
  "call the `bookFlight` tool ONCE PER flight, issuing all of those calls " +
  "together in a single turn (do not ask clarifying questions; infer reasonable " +
  "values). Each `bookFlight` result is FINAL and reports that flight's booking " +
  "status (booked or declined). Never call `bookFlight` again for a flight that " +
  "already returned a result. Once every requested flight has a result, reply " +
  "with a one-line summary and call no further tools.";

// --- AI SDK agent: native `needsApproval` on a tool() with no execute --------
const aisdkAgent = new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) =>
    streamText({
      model: openai("gpt-5.5"),
      system: BOOKING_SYSTEM_PROMPT,
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      tools: {
        bookFlight: tool({
          description: "Book a flight for the user. Requires human approval.",
          inputSchema: bookFlightInput,
          needsApproval: true,
        }),
      },
      abortSignal,
    }),
});

// --- TanStack AI agent: native `needsApproval` on a toolDefinition ------------
// TanStack derives the tool's JSON schema from `inputSchema` as-is (it doesn't
// run a Zod→JSON-schema pass the way the AI SDK does), so pass a plain JSON
// schema here — a Zod object would reach OpenAI with no `properties`.
const tanstackBookFlight = toolDefinition({
  name: "bookFlight",
  description: "Book a flight for the user. Requires human approval.",
  inputSchema: {
    type: "object",
    properties: {
      destination: { type: "string", description: "Destination city" },
      date: { type: "string", description: "Travel date, if mentioned" },
    },
    required: ["destination"],
    additionalProperties: false,
  },
  needsApproval: true,
});

const tanstackAgent = new BuiltInAgent({
  type: "tanstack",
  factory: ({ input, abortController }) => {
    const { messages, systemPrompts } = convertInputToTanStackAI(input);

    return chat({
      adapter: openaiText("gpt-5.5"),
      messages,
      systemPrompts: [BOOKING_SYSTEM_PROMPT, ...systemPrompts],
      tools: [tanstackBookFlight],
      abortController,
    });
  },
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
