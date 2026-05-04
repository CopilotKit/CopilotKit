import { Config } from "@oclif/core";
import chalk from "chalk";
import ora from "ora";

import { AuthService } from "../services/auth.service.js";
import { BaseCommand } from "./base-command.js";

export default class CloudLogout extends BaseCommand {
  static override description = "Logout from Copilot Cloud";

  static override examples = ["<%= config.bin %> logout"];

  constructor(
    argv: string[],
    config: Config,
    private authService = new AuthService(),
  ) {
    super(argv, config);
  }

  public async run(): Promise<void> {
    await this.parse(CloudLogout);
    this.log("Logging out...\n");
    await this.authService.logout(this);
    this.log(chalk.green("Successfully logged out!"));
  }
}
