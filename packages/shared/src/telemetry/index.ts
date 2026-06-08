// Bind `lambdaClient` as a local const in this entry module rather than
// re-exporting it across the module boundary. `tsdown` mis-compiles a
// cross-module `export { ... } from "./lambda-client"` of the client into
// an assignment of the whole module namespace (so `lambdaClient.send` is
// undefined and the real client ends up under `.default`), which crashes
// every caller. Importing the default here and re-exporting a fresh local
// binding compiles to a plain property reference that survives bundling.
import lambdaClientDefault from "./lambda-client";

export * from "./telemetry-client";
export const lambdaClient = lambdaClientDefault;
export {
  parseTelemetryIdFromLicense,
  parseAndWarnTelemetryId,
} from "./lambda-client";
export type { LambdaSendOptions } from "./lambda-client";
