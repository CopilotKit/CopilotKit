export * from "./telemetry-client";
export {
  lambdaClient,
  parseTelemetryIdFromLicense,
  parseAndWarnTelemetryId,
} from "./lambda-client";
export type { LambdaSendOptions } from "./lambda-client";
