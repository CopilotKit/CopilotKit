export { isTelemetryDisabled } from "./is-telemetry-disabled";
export * from "./sampling";
export {
  lambdaClient,
  parseTelemetryIdFromLicense,
  parseAndWarnTelemetryId,
} from "./lambda-client";
export type { LambdaSendOptions } from "./lambda-client";
