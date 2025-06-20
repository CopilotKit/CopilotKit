import { defineConfig, Options } from "tsup";

export default defineConfig((options: Options) => ({
  entry: {
    // Explicitly list all non-test entry points
    index: "src/index.ts",
    "constants/index": "src/constants/index.ts",
    "telemetry/events": "src/telemetry/events.ts",
    "telemetry/index": "src/telemetry/index.ts",
    "telemetry/security-check": "src/telemetry/security-check.ts",
    "telemetry/telemetry-client": "src/telemetry/telemetry-client.ts",
    "telemetry/utils": "src/telemetry/utils.ts",
    "types/action": "src/types/action.ts",
    "types/copilot-cloud-config": "src/types/copilot-cloud-config.ts",
    "types/index": "src/types/index.ts",
    "types/openai-assistant": "src/types/openai-assistant.ts",
    "types/trace": "src/types/trace.ts",
    "types/utility": "src/types/utility.ts",
    "utils/conditions": "src/utils/conditions.ts",
    "utils/errors": "src/utils/errors.ts",
    "utils/index": "src/utils/index.ts",
    "utils/json-schema": "src/utils/json-schema.ts",
    "utils/random-id": "src/utils/random-id.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  minify: false,
  external: [],
  sourcemap: true,
  ...options,
}));
