import { CreateCopilotRuntimeServerOptions } from "../shared";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";

export function copilotRuntimeNodeExpressEndpoint(options: CreateCopilotRuntimeServerOptions) {
  return copilotRuntimeNodeHttpEndpoint(options);
}
