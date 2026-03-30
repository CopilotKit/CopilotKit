import spawn from "cross-spawn";
import chalk from "chalk";
import inquirer from "inquirer";
import { Command } from "@oclif/core";

export interface SkillSyncOptions {
  global?: boolean;
  agent?: string[];
}

/**
 * Prompt the user for install scope if --global was not explicitly passed.
 */
export async function resolveScope(
  cmd: Command,
  flags: { global?: boolean },
): Promise<boolean> {
  if (flags.global) return true;

  const { scope } = await inquirer.prompt([
    {
      type: "list",
      name: "scope",
      message: "Where should CopilotKit skills be installed?",
      choices: [
        { name: "This project only", value: "project" },
        { name: "All projects (global)", value: "global" },
      ],
    },
  ]);

  return scope === "global";
}

/**
 * Build the args array for `npx skills add` from the resolved options.
 */
export function buildSkillsAddArgs(options: SkillSyncOptions): string[] {
  const args = ["skills", "add", "copilotkit/skills", "--full-depth", "-y"];

  if (options.global) {
    args.push("--global");
  }

  if (options.agent?.length) {
    args.push("--agent", ...options.agent);
  }

  return args;
}

/**
 * Run `npx skills add` with the given options. Streams output to the terminal.
 * Calls gracefulError on the command if the subprocess fails.
 */
export async function runSkillsSync(
  cmd: Command & { gracefulError(msg: string): Promise<void> },
  options: SkillSyncOptions,
): Promise<void> {
  const args = buildSkillsAddArgs(options);

  cmd.log(chalk.cyan("\nSyncing CopilotKit skills...\n"));

  const result = spawn.sync("npx", args, { stdio: "inherit" });

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
      await cmd.gracefulError(
        "Failed to run skills installer. Make sure npm/npx is available and try again.",
      );
    }

    await cmd.gracefulError(`Failed to sync skills: ${result.error.message}`);
  }

  if (result.status !== 0) {
    await cmd.gracefulError(
      `Skills sync failed with exit code ${result.status}. Check the output above for details.`,
    );
  }

  cmd.log(chalk.green("\nSkills synced successfully!\n"));
}
