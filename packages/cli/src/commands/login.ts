import { Config } from "@oclif/core";

import { AuthService } from "../services/auth.service.js";
import { BaseCommand } from "./base-command.js";

export default class CloudLogin extends BaseCommand {
  static override description = "Login to Copilot Cloud";

  static override examples = ["<%= config.bin %> login"];

  constructor(
    argv: string[],
    config: Config,
    private authService = new AuthService(),
  ) {
    super(argv, config);
  }

  public async run(): Promise<void> {
    await this.parse(CloudLogin);

    try {
      await this.authService.login();
    } catch (error: unknown) {
      this.gracefulError((error as Error).message);
    }
  }
}
