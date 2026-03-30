import { Config, Flags } from "@oclif/core";
import chalk from "chalk";

import { BaseCommand } from "../base-command.js";
import {
  resolveScope,
  resolveAgents,
  runSkillsSync,
  savePreferences,
} from "./utils.js";

export default class SkillOnboard extends BaseCommand {
  static override description =
    "Install CopilotKit skills and get onboarding instructions for your AI coding agent";

  static override examples = [
    "<%= config.bin %> skill onboard",
    "<%= config.bin %> skill onboard --global",
    "<%= config.bin %> skill onboard --agent claude-code cursor",
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
    const { flags } = await this.parse(SkillOnboard);

    const isGlobal = flags.global || (await resolveScope(flags));
    const agents = await resolveAgents(flags);

    // Save preferences so `skill sync` can reuse them
    savePreferences({ global: isGlobal, agents });

    await runSkillsSync(this, {
      global: isGlobal,
      agent: agents,
    });

    this.log(chalk.bold("To start onboarding:"));
    this.log(chalk.blue("  1. Open your AI coding agent in this project"));
    this.log(chalk.blue('  2. Type: "Help me onboard to CopilotKit"'));
    this.log("");
    this.log(
      chalk.gray(
        "This will walk you through CopilotKit setup, feature development,",
      ),
    );
    this.log(chalk.gray("and debugging workflows."));
    this.log("");
  }
}
