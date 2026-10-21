import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { FORMATS, MODELS, TRANSPORTS, getAgentId } from "../../../settings";

const agentUrl = (
  process.env.ADK_AGENT_URL ?? "http://localhost:8011/copilotkit"
).replace(/\/+$/, "");

// Each combination has its own ADK endpoint and runtime agent identity.
const agents = Object.fromEntries(
  MODELS.flatMap((model) =>
    FORMATS.flatMap((format) =>
      TRANSPORTS.map((transport) => {
        const agentId = getAgentId({ model, format, transport });
        return [
          agentId,
          new HttpAgent({
            agentId,
            url: `${agentUrl}/${model}/${format}/${transport}`,
          }),
        ];
      }),
    ),
  ),
);

// Tool runs receive render_ui; markdown runs write a2ui fences instead.
const runtime = new CopilotRuntime({
  agents,
  runner: new InMemoryAgentRunner(),
  generativeUI: true,
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
