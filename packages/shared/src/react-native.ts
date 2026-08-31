// React Native resolves this entry through the package's `react-native`
// condition. It deliberately preserves every client-safe root export while
// excluding the Node-only Segment TelemetryClient.
export * from "./common";
export * from "./telemetry/client";
