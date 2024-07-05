import { CreateCopilotRuntimeServerOptions } from "../shared";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";
import telemetry from "../../telemetry-client";

export function copilotRuntimeNodeExpressEndpoint(options: CreateCopilotRuntimeServerOptions) {
  telemetry.setGlobalProperties({
    runtime: {
      framework: "node-express",
    },
  });

  telemetry.capture("oss.runtime.instance_created", {});
  return copilotRuntimeNodeHttpEndpoint(options);
}
