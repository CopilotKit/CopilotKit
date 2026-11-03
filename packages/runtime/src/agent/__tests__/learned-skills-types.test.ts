import { it, expectTypeOf } from "vitest";
import type { AgentFactoryContext, BuiltInAgentFactoryContext } from "../..";
import type { BuiltInAgentLearnedSkills } from "../learned-skills";

it("exports distinct runtime and BuiltInAgent contexts", () => {
  expectTypeOf<
    BuiltInAgentFactoryContext["learnedSkills"]
  >().toEqualTypeOf<BuiltInAgentLearnedSkills>();
  expectTypeOf<AgentFactoryContext>().toHaveProperty("request");
});

// Compiled by the package type check, never executed with a fabricated context.
function immutableDefinitions(context: BuiltInAgentLearnedSkills) {
  // @ts-expect-error The invocation's frozen definitions cannot be mutated.
  context.definitions.push(context.definitions[0]);
  return [...context.definitions];
}
void immutableDefinitions;

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
