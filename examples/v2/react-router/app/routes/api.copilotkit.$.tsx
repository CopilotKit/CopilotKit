import type { Route } from "./+types/api.copilotkit.$";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
  BuiltInAgent,
  convertInputToTanStackAI,
  convertMessagesToVercelAISDKMessages,
  convertToolsToVercelAITools,
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
  "with a one-line summary and call no further tools. " +
  "If the user asks to crash a tool or test a tool error, call the `crash` tool. " +
  "Do not call tools when the user asks to crash the run.";

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) continue;
    const text = message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join(" ");
    if (text.trim()) return text;
  }
  return "";
}

/** Chat phrase that fails the agent run on the server before the model is called. */
function shouldFailRun(input: { messages?: unknown }): boolean {
  const text = lastUserText(input.messages).toLowerCase();
  return text.includes("crash the run") || text.includes("fail this run");
}

// --- AI SDK agent: native `needsApproval` on a tool() with no execute --------
const aisdkAgent = new BuiltInAgent({
  type: "aisdk",
  factory: ({ input, abortSignal }) => {
    if (shouldFailRun(input)) {
      throw new Error("Inspector lab: the agent run failed.");
    }
    return streamText({
      model: openai("gpt-5.5"),
      system: BOOKING_SYSTEM_PROMPT,
      messages: convertMessagesToVercelAISDKMessages(input.messages),
      tools: {
        ...convertToolsToVercelAITools(input.tools ?? []),
        bookFlight: tool({
          description: "Book a flight for the user. Requires human approval.",
          inputSchema: bookFlightInput,
          needsApproval: true,
        }),
      },
      abortSignal,
    });
  },
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
    if (shouldFailRun(input)) {
      throw new Error("Inspector lab: the agent run failed.");
    }
    const { messages, systemPrompts, tools } = convertInputToTanStackAI(input);

    return chat({
      adapter: openaiText("gpt-5.5"),
      messages,
      systemPrompts: [BOOKING_SYSTEM_PROMPT, ...systemPrompts],
      tools: [...tools, tanstackBookFlight],
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

const FAIL_THREADS_COOKIE = "cpk_lab_fail_threads=1";
const FAIL_MEMORIES_COOKIE = "cpk_lab_fail_memories=1";
const LAB_MEMORY_WS_URL = "ws://127.0.0.1:9/memories";

function shouldFailThreadList(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie.includes(FAIL_THREADS_COOKIE)) return false;
  const path = new URL(request.url).pathname;
  return request.method === "GET" && path.endsWith("/threads");
}

function hasCookie(request: Request, cookie: string): boolean {
  return (request.headers.get("cookie") ?? "").includes(cookie);
}

function handleLabMemoryRequest(request: Request): Response | null {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path.endsWith("/memories")) {
    if (hasCookie(request, FAIL_MEMORIES_COOKIE)) {
      return new Response(JSON.stringify({ error: "memory list refused" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ memories: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // The lab needs a memory REST failure, not a live Intelligence connection.
  // A 422 is the SDK's supported silent-degrade signal for this optional feed.
  if (path.endsWith("/memories/subscribe")) {
    return new Response(null, { status: 422 });
  }

  return null;
}

async function handleLabRequest(request: Request): Promise<Response> {
  const memoryResponse = handleLabMemoryRequest(request);
  if (memoryResponse) return memoryResponse;

  const response = await handler(request);
  const path = new URL(request.url).pathname;
  if (request.method !== "GET" || !path.endsWith("/info") || !response.ok) {
    return response;
  }

  const runtimeInfo = (await response.json()) as Record<string, unknown>;
  return Response.json(
    {
      ...runtimeInfo,
      intelligence: { wsUrl: LAB_MEMORY_WS_URL },
    },
    { status: response.status, headers: response.headers },
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  if (shouldFailThreadList(request)) {
    return new Response(JSON.stringify({ error: "list refused" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  return handleLabRequest(request);
}

export async function action({ request }: Route.ActionArgs) {
  return handleLabRequest(request);
}
