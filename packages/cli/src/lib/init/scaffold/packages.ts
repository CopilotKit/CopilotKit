/*
    Currently unusued but will be used in the future once we have more time to think
    about what to use outside of shadcn/ui.
*/

import spawn from "cross-spawn";
import { Config } from "../types/index.js";
import chalk from "chalk";
import fs from "fs";
import ora from "ora";

type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export async function scaffoldPackages(userAnswers: Config) {
  const spinner = ora({
    text: chalk.cyan("Preparing to install packages..."),
    color: "cyan",
  }).start();

  try {
    const packages = [
      `@copilotkit/react-ui@${userAnswers.copilotKitVersion}`,
      `@copilotkit/react-core@${userAnswers.copilotKitVersion}`,
      `@copilotkit/runtime@${userAnswers.copilotKitVersion}`,
    ];

    // Small pause before starting
    await new Promise((resolve) => setTimeout(resolve, 50));

    const packageManager = detectPackageManager();
    const installCommand = detectInstallCommand(packageManager);

    spinner.text = chalk.cyan(`Using ${packageManager} to install packages...`);

    // Pause the spinner for the package installation
    spinner.stop();

    console.log(chalk.cyan("\n⚙️  Installing packages...\n"));

    const result = spawn.sync(packageManager, [installCommand, ...packages], {
      stdio: "inherit", // This ensures stdin/stdout/stderr are all passed through
    });

    if (result.status !== 0) {
      throw new Error(
        `Package installation process exited with code ${result.status}`,
      );
    }

    // Resume the spinner for success message
    spinner.start();
    spinner.succeed(chalk.green("CopilotKit packages installed successfully"));
  } catch (error) {
    // Use spinner for consistent error reporting
    if (!spinner.isSpinning) {
      spinner.start();
    }
    spinner.fail(chalk.red("Failed to install CopilotKit packages"));
    throw error;
  }
}

function detectPackageManager(): PackageManager {
  // Check for lock files in the current directory
  const files = fs.readdirSync(process.cwd());

  if (files.includes("bun.lockb")) return "bun";
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("package-lock.json")) return "npm";

  // Default to npm if no lock file found
  return "npm";
}

function detectInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "yarn":
    case "pnpm":
      return "add";
    default:
      return "install";
  }
}
