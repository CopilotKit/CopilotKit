import { Config, Flags } from "@oclif/core";

import { BaseCommand } from "../base-command.js";
import { resolveScope, runSkillsSync } from "./utils.js";

export default class SkillSync extends BaseCommand {
  static override description =
    "Install or update CopilotKit skills for AI coding agents";

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

    const isGlobal = flags.global || (await resolveScope(this, flags));

    await runSkillsSync(this, {
      global: isGlobal,
      agent: flags.agent,
    });
  }
}
