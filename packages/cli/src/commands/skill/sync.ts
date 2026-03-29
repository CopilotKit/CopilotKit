import { Config } from "@oclif/core";
import spawn from "cross-spawn";
import chalk from "chalk";

import { BaseCommand } from "../base-command.js";

export default class SkillSync extends BaseCommand {
  static override description =
    "Install or update CopilotKit skills for AI coding agents";

  static override examples = ["<%= config.bin %> skill sync"];

  constructor(argv: string[], config: Config) {
    super(argv, config);
  }

  public async run(): Promise<void> {
    await this.parse(SkillSync);

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

    this.log(chalk.green("\nSkills synced successfully!"));
    this.log(
      chalk.blue("Next: run 'npx copilotkit skill onboard' to get started.\n"),
    );
  }
}
