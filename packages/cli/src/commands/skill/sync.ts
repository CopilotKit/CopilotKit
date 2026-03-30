import { Config, Flags } from "@oclif/core";
import chalk from "chalk";

import { BaseCommand } from "../base-command.js";
import { loadPreferences, resolveScope, runSkillsSync } from "./utils.js";

export default class SkillSync extends BaseCommand {
  static override description = "Update CopilotKit skills for AI coding agents";

  static override examples = [
    "<%= config.bin %> skill sync",
    "<%= config.bin %> skill sync --global",
    "<%= config.bin %> skill sync --agent claude-code cursor",
  ];

  static override flags = {
    global: Flags.boolean({
      char: "g",
      description:
        "Install skills globally (user-level) instead of project-level",
      default: false,
    }),
    agent: Flags.string({
      char: "a",
      description: "Specify agents to install to (e.g. claude-code, cursor)",
      multiple: true,
    }),
  };

  constructor(argv: string[], config: Config) {
    super(argv, config);
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(SkillSync);

    // Reuse saved preferences from onboard if no flags were explicitly passed
    const saved = loadPreferences();

    const isGlobal =
      flags.global || saved?.global || (await resolveScope(flags));
    const agents = flags.agent?.length ? flags.agent : saved?.agents;

    if (saved) {
      const scope = isGlobal ? "global" : "project";
      const agentDesc = agents?.length ? agents.join(", ") : "all detected";
      this.log(
        chalk.gray(
          `Using saved preferences (${scope}, agents: ${agentDesc}). Pass flags to override.`,
        ),
      );
    }

    await runSkillsSync(this, {
      global: isGlobal,
      agent: agents,
    });
  }
}
