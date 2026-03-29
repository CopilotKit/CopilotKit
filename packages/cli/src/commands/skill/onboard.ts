import { Config } from "@oclif/core";
import chalk from "chalk";

import { BaseCommand } from "../base-command.js";

export default class SkillOnboard extends BaseCommand {
  static override description =
    "Get onboarding instructions for CopilotKit skills";

  static override examples = ["<%= config.bin %> skill onboard"];

  constructor(argv: string[], config: Config) {
    super(argv, config);
  }

  public async run(): Promise<void> {
    await this.parse(SkillOnboard);

    this.log("");
    this.log(chalk.bold("To start onboarding:"));
    this.log(chalk.blue("  1. Open Claude Code in your project"));
    this.log(chalk.blue('  2. Type: "onboard me"'));
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
