import chalk from "chalk";

export function flattenObject(
  obj: Record<string, any>,
  parentKey = "",
  res: Record<string, any> = {},
): Record<string, any> {
  for (let key in obj) {
    const propName = parentKey ? `${parentKey}.${key}` : key;
    if (typeof obj[key] === "object" && obj[key] !== null) {
      flattenObject(obj[key], propName, res);
    } else {
      res[propName] = obj[key];
    }
  }
  return res;
}

export function printSecurityNotice(advisory: {
  advisory: string | null;
  message: string;
  severity: "low" | "medium" | "high" | "none";
}) {
  const severityColor =
    {
      low: chalk.blue,
      medium: chalk.yellow,
      high: chalk.red,
    }[advisory.severity.toLowerCase()] || chalk.white;

  console.log();
  console.log(`━━━━━━━━━━━━━━━━━━ ${chalk.bold(`CopilotKit`)} ━━━━━━━━━━━━━━━━━━`);
  console.log();
  console.log(`${chalk.bold(`Severity: ${severityColor(advisory.severity.toUpperCase())}`)}`);
  console.log();
  console.log(`${chalk.bold(advisory.message)}`);
  console.log();
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
