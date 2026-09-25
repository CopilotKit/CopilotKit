import {
  BuiltInAgent,
  CopilotKitIntelligence,
  CopilotRuntime,
  convertInputToTanStackAI,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { appendFileSync } from "node:fs";
import { assertSameOrigin, userFromRequest } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function makeHandler() {
  const apiKey = process.env.CPK_INTELLIGENCE_API_KEY;
  if (!apiKey) return null;
  const intelligence = new CopilotKitIntelligence({
    apiKey,
    autopilot: { enabled: true },
  });
  const makeAgent = () =>
    new BuiltInAgent({
      type: "tanstack",
      factory: ({ input, abortController }) => {
        const { messages, systemPrompts, tools } =
          convertInputToTanStackAI(input);
        const auditFile = process.env.AUTOPILOT_MODEL_INPUT_AUDIT_FILE;
        const auditCanaries = process.env.AUTOPILOT_MODEL_INPUT_AUDIT_CANARIES;
        if (auditFile && auditCanaries) {
          try {
            const modelInput = JSON.stringify({
              messages,
              systemPrompts,
              tools,
            });
            const canaryMatches = auditCanaries
              .split(",")
              .map((canary) => modelInput.includes(canary));
            appendFileSync(
              auditFile,
              `${JSON.stringify({ threadId: input.threadId, canaryMatches, messageCount: messages.length })}\n`,
            );
          } catch {
            // Optional local audit must not prevent the live agent from running.
          }
        }
        return chat({
          adapter: openaiText(
            (process.env.AUTOPILOT_MODEL || "gpt-5.2") as Parameters<
              typeof openaiText
            >[0],
          ),
          messages,
          systemPrompts,
          tools,
          abortController,
        });
      },
    });
  const copilotRuntime = new CopilotRuntime({
    agents: () => ({
      logistics: makeAgent(),
      operations: makeAgent(),
    }),
    intelligence,
    identifyUser: (request) => {
      const user = userFromRequest(request);
      if (!user) throw new Error("Session required");
      return {
        id: `${user.organizationId}:${user.id}`,
        name: user.displayName,
      };
    },
    generateThreadNames: false,
  });
  return createCopilotRuntimeHandler({
    runtime: copilotRuntime,
    basePath: "/api/copilotkit",
    hooks: {
      onRequest: ({ request }) => {
        if (!userFromRequest(request))
          throw new Response("Session required", { status: 401 });
        try {
          assertSameOrigin(request);
        } catch {
          throw new Response("Cross-origin request refused", { status: 403 });
        }
      },
    },
  });
}

let handler: ReturnType<typeof makeHandler> | undefined;
function getHandler() {
  return (handler ??= makeHandler());
}
function handle(request: Request) {
  const activeHandler = getHandler();
  if (!activeHandler)
    return Response.json(
      { error: "CPK_INTELLIGENCE_API_KEY is required" },
      { status: 503 },
    );
  return activeHandler(request);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
