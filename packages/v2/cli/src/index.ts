import chalk from "chalk";
import { typegen } from "./typegen";

const LOGO = `
${chalk.bold.cyan("  ╔═══════════════════════════╗")}
${chalk.bold.cyan("  ║")}  ${chalk.bold.white("CopilotKit CLI")}  ${chalk.dim("v1.52.0")}  ${chalk.bold.cyan("║")}
${chalk.bold.cyan("  ╚═══════════════════════════╝")}
`;

function printHelp() {
  console.log(LOGO);
  console.log(`  ${chalk.bold("Usage:")}`);
  console.log(
    `    ${chalk.cyan("copilotkit")} ${chalk.yellow("<command>")} ${chalk.dim("[options]")}\n`,
  );
  console.log(`  ${chalk.bold("Commands:")}`);
  console.log(
    `    ${chalk.yellow("typegen")} ${chalk.dim("<url1,url2,...>")}   Generate type-safe TypeScript types from your runtime\n`,
  );
  console.log(`  ${chalk.bold("Examples:")}`);
  console.log(
    `    ${chalk.dim("$")} ${chalk.cyan("copilotkit typegen")} http://localhost:3000/api/copilotkit`,
  );
  console.log(
    `    ${chalk.dim("$")} ${chalk.cyan("copilotkit typegen")} http://localhost:3000/api/copilotkit,http://localhost:4000/api/copilotkit\n`,
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case "typegen": {
      const urlArg = args[1];
      if (!urlArg) {
        console.log();
        console.error(
          `  ${chalk.red.bold("Error:")} typegen requires at least one URL.\n`,
        );
        console.log(
          `  ${chalk.bold("Usage:")} ${chalk.cyan("copilotkit typegen")} ${chalk.dim("<url1,url2,...>")}\n`,
        );
        process.exit(1);
      }

      const urls = urlArg
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean);
      if (urls.length === 0) {
        console.error(
          `\n  ${chalk.red.bold("Error:")} No valid URLs provided.\n`,
        );
        process.exit(1);
      }

      await typegen(urls);
      break;
    }
    default:
      console.log();
      console.error(
        `  ${chalk.red.bold("Error:")} Unknown command ${chalk.yellow(command)}\n`,
      );
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\n  ${chalk.red.bold("Fatal error:")} ${error}\n`);
  process.exit(1);
});
