import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { map } from "rxjs";
import type { Observable } from "rxjs";

// Dedicated runtime for the Open Generative UI demos, mirroring the
// LangGraph-Python `copilotkit-ogui` route.
//
// Isolated here because the `openGenerativeUI` runtime flag sets
// `openGenerativeUIEnabled: true` globally on the probe response, which
// causes the CopilotKit provider's setTools effect to wipe per-demo
// `useFrontendTool`/`useComponent` registrations in the default runtime.
//
// Each agent name proxies to a separate `MapAGUI` endpoint on the .NET
// backend (see `agent/Program.cs`).

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";
const OGUI_TOOL_CALL_ID_SUFFIX = /__ogui_run_[0-9a-f-]+$/i;

console.log("[copilotkit-ogui/route] Initializing OGUI CopilotKit runtime");
console.log(`[copilotkit-ogui/route] AGENT_URL: ${AGENT_URL}`);

function stripOguiToolCallId(id: string): string {
  return id.replace(OGUI_TOOL_CALL_ID_SUFFIX, "");
}

function makeOguiToolCallId(id: string, runId: string): string {
  return `${stripOguiToolCallId(id)}__ogui_run_${runId}`;
}

function stripOguiToolCallIdsFromMessage(message: unknown): unknown {
  if (!message || typeof message !== "object") return message;

  const next = { ...(message as Record<string, unknown>) };
  let changed = false;

  if (typeof next.toolCallId === "string") {
    next.toolCallId = stripOguiToolCallId(next.toolCallId);
    changed = true;
  }

  if (typeof next.tool_call_id === "string") {
    next.tool_call_id = stripOguiToolCallId(next.tool_call_id);
    changed = true;
  }

  if (Array.isArray(next.toolCalls)) {
    next.toolCalls = next.toolCalls.map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object") return toolCall;
      const call = { ...(toolCall as Record<string, unknown>) };
      if (typeof call.id === "string") {
        call.id = stripOguiToolCallId(call.id);
      }
      return call;
    });
    changed = true;
  }

  return changed ? next : message;
}

class OpenGenUiHttpAgent extends HttpAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    const toolCallIds = new Map<string, string>();
    const runId = input.runId;
    const sanitizedInput = {
      ...input,
      messages: input.messages.map(stripOguiToolCallIdsFromMessage),
    } as RunAgentInput;

    return super.run(sanitizedInput).pipe(
      map((event: BaseEvent) => {
        const e = event as BaseEvent & {
          toolCallId?: string;
          toolCallName?: string;
        };

        if (
          (e.type === "TOOL_CALL_START" || e.type === "TOOL_CALL_CHUNK") &&
          e.toolCallName === "generateSandboxedUi" &&
          e.toolCallId
        ) {
          const originalId = stripOguiToolCallId(e.toolCallId);
          const rewrittenId = makeOguiToolCallId(originalId, runId);
          toolCallIds.set(originalId, rewrittenId);
          return { ...event, toolCallId: rewrittenId };
        }

        if (e.toolCallId) {
          const originalId = stripOguiToolCallId(e.toolCallId);
          const rewrittenId = toolCallIds.get(originalId);
          if (rewrittenId) {
            return { ...event, toolCallId: rewrittenId };
          }
        }

        return event;
      }),
    );
  }
}

const openGenUiAgent = new OpenGenUiHttpAgent({
  url: `${AGENT_URL}/open-gen-ui`,
});
const openGenUiAdvancedAgent = new OpenGenUiHttpAgent({
  url: `${AGENT_URL}/open-gen-ui-advanced`,
});

const agents: Record<string, AbstractAgent> = {
  "open-gen-ui": openGenUiAgent,
  "open-gen-ui-advanced": openGenUiAdvancedAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-ogui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      // Server-side config is identical for the minimal and advanced cells —
      // the advanced behaviour (sandbox -> host function calls) is wired
      // entirely on the frontend via `openGenerativeUI.sandboxFunctions` on
      // the provider. The single `openGenerativeUI` flag below turns on
      // Open Generative UI for the listed agent(s); the runtime middleware
      // converts each agent's streamed `generateSandboxedUi` tool call into
      // `open-generative-ui` activity events.
      // @region[minimal-runtime-flag]
      // @region[advanced-runtime-config]
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
        openGenerativeUI: {
          agents: ["open-gen-ui", "open-gen-ui-advanced"],
        },
      }),
      // @endregion[advanced-runtime-config]
      // @endregion[minimal-runtime-flag]
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[copilotkit-ogui/route] ERROR: ${err.message}`);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 },
    );
  }
};
