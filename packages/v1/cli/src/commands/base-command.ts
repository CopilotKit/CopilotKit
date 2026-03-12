import { Command } from "@oclif/core";
import Sentry, { consoleIntegration } from "@sentry/node";
import { LIB_VERSION } from "../utils/version.js";
import { COPILOT_CLOUD_BASE_URL } from "../utils/trpc.js";
import chalk from "chalk";

export class BaseCommand extends Command {
  async init() {
    await this.checkCLIVersion();

    if (process.env.SENTRY_DISABLED === "true") {
      return;
    }

    Sentry.init({
      dsn:
        process.env.SENTRY_DSN ||
        "https://1eea15d32e2eacb0456a77db5e39aeeb@o4507288195170304.ingest.us.sentry.io/4508581448581120",
      integrations: [consoleIntegration()],
      // Tracing
      tracesSampleRate: 1.0, //  Capture 100% of the transactions
    });
  }

  async catch(err: any) {
    if (process.env.SENTRY_DISABLED !== "true") {
      Sentry.captureException(err);
    }

    const message = err?.message ?? "Unknown error";

    this.log("\n" + chalk.red(message) + "\n");

    const exitCode = err?.oclif?.exit ?? 1;
    this.exit(exitCode);
  }

  async finally() {
    if (process.env.SENTRY_DISABLED === "true") {
      return;
    }

    Sentry.close();
  }

  async run() {}

  async checkCLIVersion() {
    try {
      const response = await fetch(`${COPILOT_CLOUD_BASE_URL}/api/healthz`);

      const data = await response.json();
      const cloudVersion = data.cliVersion;

      if (!cloudVersion || cloudVersion === LIB_VERSION) {
        return;
      }

      // TODO: add this back in, removed for crew ai launch since we don't want to keep releasing cloud
      // this.log(chalk.yellow('================ New version available! =================\n'))
      // this.log(`You are using CopilotKit CLI v${LIB_VERSION}.`)
      // this.log(`A new CopilotKit CLI version is available (v${cloudVersion}).\n`)
      // this.log('Please update your CLI to the latest version:\n\n')
      // this.log(`${chalk.cyan(chalk.underline(chalk.bold('npm:')))}\t npm install -g copilotkit@${cloudVersion}\n`)
      // this.log(`${chalk.cyan(chalk.underline(chalk.bold('pnpm:')))}\t pnpm install -g copilotkit@${cloudVersion}\n`)
      // this.log(`${chalk.cyan(chalk.underline(chalk.bold('yarn:')))}\t yarn global add copilotkit@${cloudVersion}\n`)
      // this.log(chalk.yellow('============================================================\n\n'))
    } catch {
      // Version check is non-critical — don't crash the CLI when offline
    }
  }

  async gracefulError(message: string) {
    this.log("\n" + chalk.red(message));
    process.exit(1);
  }
}
