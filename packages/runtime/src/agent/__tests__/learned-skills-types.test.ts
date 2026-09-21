import { it, expectTypeOf } from "vitest";
import type { ToolSet } from "ai";
import type { AgentFactoryContext, BuiltInAgentFactoryContext } from "../../v2";
import type { BuiltInAgentLearnedSkills } from "../learned-skills";

it("exports distinct runtime and BuiltInAgent contexts", () => {
  expectTypeOf<
    BuiltInAgentFactoryContext["learnedSkills"]
  >().toEqualTypeOf<BuiltInAgentLearnedSkills>();
  expectTypeOf<AgentFactoryContext>().toHaveProperty("request");
});

// Compiled by the package type check, never executed with a fabricated context.
function immutableTools(context: BuiltInAgentLearnedSkills) {
  // @ts-expect-error The invocation's frozen tool map cannot be mutated.
  context.tools.extra = context.tools.copilotkit_load_skill;
  const combined: ToolSet = { ...context.tools };
  combined.extra = context.tools.copilotkit_load_skill;
  return combined;
}
void immutableTools;
