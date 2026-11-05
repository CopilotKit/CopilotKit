import { it, expectTypeOf } from "vitest";
import type { AnyTool } from "@tanstack/ai";
import type { AgentFactoryContext, BuiltInAgentFactoryContext } from "../..";
import type { BuiltInAgentLearnedSkills } from "../learned-skills";

it("exports distinct runtime and BuiltInAgent contexts", () => {
  expectTypeOf<
    BuiltInAgentFactoryContext["learnedSkills"]
  >().toEqualTypeOf<BuiltInAgentLearnedSkills>();
  expectTypeOf<AgentFactoryContext>().toHaveProperty("request");
});

// Compiled by the package type check, never executed with a fabricated context.
function immutableTools(context: BuiltInAgentLearnedSkills, extra: AnyTool) {
  // @ts-expect-error The invocation's frozen tool list cannot be mutated.
  context.tools.push(extra);
  // A copy is a plain TanStack tool list that a factory can extend.
  const combined: AnyTool[] = [...context.tools];
  combined.push(extra);
  return combined;
}
void immutableTools;

// Canonical batch transport types are available through the public v2 entry.
import type {
  GetLearnedSkillsSnapshotsRequest,
  LearnedSkillsBatchResult,
} from "../..";
const batchRequest: GetLearnedSkillsSnapshotsRequest = {
  containers: [{ containerId: "support" }],
};
const batchResult: LearnedSkillsBatchResult = {
  containerId: "support",
  status: "unchanged",
  revision: "r1",
  etag: '"etag"',
};
void [batchRequest, batchResult];
