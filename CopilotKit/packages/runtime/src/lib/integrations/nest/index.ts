import { CreateCopilotRuntimeServerOptions } from "../shared";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";
import telemetry from "../../telemetry-client";

export function copilotRuntimeNestEndpoint(options: CreateCopilotRuntimeServerOptions) {
  telemetry.setGlobalProperties({
    runtime: {
      framework: "nest",
    },
  });

  telemetry.capture("oss.runtime.instance_created", {});
  return copilotRuntimeNodeHttpEndpoint(options);
}
