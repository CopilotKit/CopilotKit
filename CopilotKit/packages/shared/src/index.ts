export * from "./types";
export * from "./utils";
export * from "./constants";
export * from "./telemetry";

import * as packageJson from "../package.json";
export const COPILOTKIT_VERSION = packageJson.version;
