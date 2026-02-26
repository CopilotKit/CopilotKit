import { CopilotRuntime } from "../runtime";
import { AgentDescription, RuntimeInfo } from "@copilotkitnext/shared";
import { VERSION } from "../runtime";

interface HandleGetRuntimeInfoParameters {
  runtime: CopilotRuntime;
  request: Request;
}

export async function handleGetRuntimeInfo({
  runtime,
}: HandleGetRuntimeInfoParameters) {
  try {
    const agents = await runtime.agents;

    const agentsDict = Object.entries(agents).reduce(
      (acc, [name, agent]) => {
        acc[name] = {
          name,
          description: agent.description,
          className: agent.constructor.name,
        };
        // TODO Extend AbstractAgent to support this
        // Include tool definitions if the agent exposes them
        if (typeof (agent as any).getToolDefinitions === "function") {
          const tools = (agent as any).getToolDefinitions();
          if (tools && tools.length > 0) {
            acc[name].tools = tools;
          }
        }

        return acc;
      },
      {} as Record<string, AgentDescription>,
    );

    const runtimeInfo: RuntimeInfo = {
      version: VERSION,
      agents: agentsDict,
      audioFileTranscriptionEnabled: !!runtime.transcriptionService,
    };

    return new Response(JSON.stringify(runtimeInfo), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to retrieve runtime information",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
