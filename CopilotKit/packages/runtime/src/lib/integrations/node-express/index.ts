import { CreateCopilotRuntimeServerOptions } from "../shared";
import { copilotRuntimeNodeHttpEndpoint } from "../node-http";
import telemetry, { getRuntimeInstanceTelemetryInfo } from "../../telemetry-client";
import { createCopilotEndpoint } from "@copilotkitnext/runtime";

export function copilotRuntimeNodeExpressEndpoint(options: CreateCopilotRuntimeServerOptions): ReturnType<typeof createCopilotEndpoint> {
  telemetry.setGlobalProperties({
    runtime: {
      framework: "node-express",
    },
  });

  // TODO: fix telemetry capture
  // telemetry.capture("oss.runtime.instance_created", getRuntimeInstanceTelemetryInfo(options));
  return copilotRuntimeNodeHttpEndpoint(options);
}
