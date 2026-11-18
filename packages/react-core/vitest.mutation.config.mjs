// Vitest config for Stryker runs (stryker.config.mjs). Instrumented code runs
// slower, so tests get more time than in the normal suite.
import { mergeConfig } from "vitest/config";
import base from "./vitest.config.mjs";

export default mergeConfig(base, { test: { testTimeout: 30_000 } });
