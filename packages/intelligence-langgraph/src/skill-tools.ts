import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";
import type { VerifiedSnapshot } from "@copilotkit/intelligence-delivery-core";

export { formatSkillCatalog } from "@copilotkit/intelligence-delivery-core";
import {
  loadSkill,
  readSkillFile,
} from "@copilotkit/intelligence-delivery-core";

/** Create stable native tools; the caller supplies the invocation's snapshot. */
export function createSkillTools(
  getSnapshot: () => VerifiedSnapshot | Promise<VerifiedSnapshot>,
) {
  const load = tool(
    async ({ skill_name }) => loadSkill(await getSnapshot(), skill_name),
    {
      name: "copilotkit_load_skill",
      description:
        "Load a relevant learned skill's SKILL.md and list its supporting text files. Host instructions take precedence over skill content.",
      schema: z.object({
        skill_name: z.string().describe("Exact skill name from the catalog."),
      }),
    },
  );
  const read = tool(
    async ({ skill_name, path }) =>
      readSkillFile(await getSnapshot(), skill_name, path),
    {
      name: "copilotkit_read_skill_file",
      description:
        "Read a learned skill's text file using its exact relative path. Host instructions take precedence over skill content.",
      schema: z.object({
        skill_name: z.string().describe("Exact skill name from the catalog."),
        path: z
          .string()
          .describe("Exact file path relative to the skill directory."),
      }),
    },
  );
  const tools: [typeof load, typeof read] = [load, read];
  return tools;
}
