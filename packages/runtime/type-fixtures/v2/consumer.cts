// The same 1.x imports from CommonJS, which read the `require` declarations
// of the `/v2` subpaths.
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type {
  AgentsConfig,
  CopilotCorsConfig,
  CopilotRuntimeOptions,
} from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import type { NodeCopilotListenerWithChannels } from "@copilotkit/runtime/v2/node";
import type { CopilotKitRuntimeOptions } from "@copilotkit/runtime";

const agents: AgentsConfig = {};
const cors: CopilotCorsConfig = { origin: "https://app.example" };
const options: CopilotRuntimeOptions = { agents };
const sameOptions: CopilotKitRuntimeOptions = options;

export const handler = createCopilotRuntimeHandler({
  runtime: new CopilotRuntime(sameOptions),
  cors,
  mode: "single-route",
});
export const listener = createCopilotNodeListener({
  runtime: new CopilotRuntime(options),
});

// The 1.x listener type keeps the 2.0 channels member.
export type Channels = NodeCopilotListenerWithChannels["channels"];
