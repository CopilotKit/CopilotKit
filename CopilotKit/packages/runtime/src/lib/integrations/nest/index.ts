import { CreateCopilotRuntimeServerOptions } from "../shared";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";

export function copilotRuntimeNestEndpoint(options: CreateCopilotRuntimeServerOptions) {
  return copilotRuntimeNodeHttpEndpoint(options);
}
