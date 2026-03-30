import spawn from "cross-spawn";
import chalk from "chalk";
import inquirer from "inquirer";
import Conf from "conf";
import { Command } from "@oclif/core";

const config = new Conf({ projectName: "CopilotKitCLI" });

const SKILL_CONFIG_KEY = "skill.preferences";

export interface SkillPreferences {
  global: boolean;
  agents?: string[];
}

export interface SkillSyncOptions {
  global?: boolean;
  agent?: string[];
}

const POPULAR_AGENTS = [
  { name: "Claude Code", value: "claude-code" },
  { name: "Cursor", value: "cursor" },
  { name: "Codex", value: "codex" },
  { name: "GitHub Copilot", value: "github-copilot" },
  { name: "Windsurf", value: "windsurf" },
  { name: "Cline", value: "cline" },
  { name: "OpenCode", value: "opencode" },
];

/**
 * Save skill preferences so sync can reuse them.
 */
export function savePreferences(prefs: SkillPreferences): void {
  config.set(SKILL_CONFIG_KEY, prefs);
}

/**
 * Load saved skill preferences, if any.
 */
export function loadPreferences(): SkillPreferences | undefined {
  return config.get(SKILL_CONFIG_KEY) as SkillPreferences | undefined;
}

/**
 * Prompt the user for install scope if --global was not explicitly passed.
 */
export async function resolveScope(flags: {
  global?: boolean;
}): Promise<boolean> {
  if (flags.global) return true;

  const { scope } = (await inquirer.prompt([
    {
      type: "list",
      name: "scope",
      message: "Where should CopilotKit skills be installed?",
      choices: [
        { name: "This project only", value: "project" },
        { name: "All projects (global)", value: "global" },
      ],
    },
  ] as any)) as { scope: string };

  return scope === "global";
}

/**
 * Prompt the user for which coding agent(s) to install skills for.
 */
export async function resolveAgents(flags: {
  agent?: string[];
}): Promise<string[]> {
  if (flags.agent?.length) return flags.agent;

  const { agents } = (await inquirer.prompt([
    {
      type: "checkbox",
      name: "agents",
      message: "Which coding agent(s) do you want to install skills for?",
      choices: [
        ...POPULAR_AGENTS,
        new inquirer.Separator(),
        { name: "All detected agents", value: "*" },
      ],
      validate: (input: string[]) =>
        input.length > 0 || "Select at least one agent.",
    },
  ] as any)) as { agents: string[] };

  // If "All detected agents" was selected, let the skills CLI handle detection
  if (agents.includes("*")) return [];

  return agents;
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
