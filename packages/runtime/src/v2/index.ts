// V2 runtime (moved from @copilotkit/runtime/v2)
export * from "./runtime";

// Agent (merged into runtime)
export * from "../agent";

// Both ./runtime and ../agent declare an `AgentFactoryContext`; re-export the
// runtime one explicitly (matching the v1 entry point) to resolve the
// star-export ambiguity.
export type { AgentFactoryContext } from "./runtime";
