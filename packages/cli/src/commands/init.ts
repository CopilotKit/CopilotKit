import { BaseCommand } from "./base-command.js";
import Create from "./create.js";

export default class CloudInit extends BaseCommand {
  static override description = "`init` is deprecated — use `create` instead.";

  static override examples = ["<%= config.bin %> create"];

  public async run(): Promise<void> {
    this.log(
      "`copilotkit init` is deprecated. Redirecting to `copilotkit create`...",
    );

    const createCommand = new Create(this.argv, this.config);
    await createCommand.run();
  }
}
