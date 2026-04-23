import chalk from "chalk";
import type { Alert } from "../loaders/remote.js";

const LEVEL_PREFIX: Record<Alert["level"], string> = {
  info: chalk.blue("ℹ"),
  warning: chalk.yellow("⚠"),
  error: chalk.red("✖"),
};

export function renderAlert(alert: Alert, log: (msg: string) => void): void {
  const prefix = LEVEL_PREFIX[alert.level] ?? LEVEL_PREFIX.info;
  log("");
  log(`${prefix}  ${alert.message}`);
}
