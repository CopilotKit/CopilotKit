import { Config } from "@oclif/core";
import spawn from "cross-spawn";
import chalk from "chalk";

import { BaseCommand } from "../base-command.js";

export default class SkillOnboard extends BaseCommand {
  static override description =
    "Install CopilotKit skills and get onboarding instructions";

  static override examples = ["<%= config.bin %> skill onboard"];

  constructor(argv: string[], config: Config) {
    super(argv, config);
  }

  public async run(): Promise<void> {
    await this.parse(SkillOnboard);

    this.log(chalk.cyan("\nSyncing CopilotKit skills...\n"));

    const result = spawn.sync(
      "npx",
      ["skills", "add", "copilotkit/skills", "--full-depth", "-y"],
      { stdio: "inherit" },
    );

    if (result.error) {
      if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.gracefulError(
          "Failed to run skills installer. Make sure npm/npx is available and try again.",
        );
      }

      await this.gracefulError(
        `Failed to sync skills: ${result.error.message}`,
      );
    }

    if (result.status !== 0) {
      await this.gracefulError(
        `Skills sync failed with exit code ${result.status}. Check the output above for details.`,
      );
    }

    this.log(chalk.green("\nSkills synced successfully!\n"));
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
