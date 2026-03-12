import { Config, Flags } from "@oclif/core";

import { BaseCommand } from "./base-command.js";
import Create from "./create.js";
import { ConfigFlags } from "../lib/init/types/questions.js";

export default class CloudInit extends BaseCommand {
  static override description =
    "Set up CopilotKit in your Next.js project, or create a new project if none exists";

  static override examples = [
    "<%= config.bin %> init",
    "<%= config.bin %> init --dir ./my-app",
  ];

  static override flags = {
    ...BaseCommand.flags,
    ...ConfigFlags,
    runtimeUrl: Flags.string({ description: "runtime URL" }),
    project: Flags.string({
      description: "project ID (can be found in the Copilot Cloud dashboard)",
    }),
    dir: Flags.string({
      description: "directory of the Next.js project",
      default: ".",
    }),
  };

  constructor(argv: string[], config: Config) {
    super(argv, config);
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(CloudInit);
    this.log("`copilotkit init` now routes to `copilotkit create`.");

    const createCommand = new Create([], this.config);
    await createCommand.run();
  }
}
