#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");
const concurrently = require("concurrently");

// Parse command line arguments
const args = process.argv.slice(2);
const showHelp = args.includes("--help") || args.includes("-h");
const dryRun = args.includes("--dry-run");

if (showHelp) {
  console.log(`
Usage: node run-dojo-everything.js [options]

Options:
  --dry-run       Show what would be started without actually running
  --help, -h      Show this help message

Examples:
  node run-dojo.js
  node run-dojo.js --dry-run
`);
  process.exit(0);
}

const gitRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();

const llmAdapters = {
  command: "pnpm run start",
  name: "LLM Adapters",
  cwd: path.join(gitRoot, "examples/llm-adapters"),
  env: {
    PORT: 9000,
    NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL: process.env.NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL,
    NEXT_PUBLIC_OPENAI_API_KEY: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
    NEXT_PUBLIC_ANTHROPIC_API_KEY: process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY,
    NEXT_PUBLIC_GOOGLEGENERATIVEAI_API_KEY: process.env.NEXT_PUBLIC_GOOGLEGENERATIVEAI_API_KEY,
    NEXT_PUBLIC_GROQ_API_KEY: process.env.NEXT_PUBLIC_GROQ_API_KEY,
    NEXT_PUBLIC_AZURE_API_KEY: process.env.NEXT_PUBLIC_AZURE_API_KEY,
    NEXT_PUBLIC_BEDROCK_API_KEY: process.env.NEXT_PUBLIC_BEDROCK_API_KEY,
  },
};

const procs = [llmAdapters];

function printDryRunServices(procs) {
  console.log("Dry run - would start the following services:");
  procs.forEach((proc) => {
    console.log(`  - ${proc.name} (${proc.cwd})`);
    console.log(`    Command: ${proc.command}`);
    console.log(`    Environment variables:`);
    if (proc.env) {
      Object.entries(proc.env).forEach(([key, value]) => {
        console.log(`      ${key}: ${value}`);
      });
    } else {
      console.log("      No environment variables specified.");
    }
    console.log("");
  });
  process.exit(0);
}

async function main() {
  if (dryRun) {
    printDryRunServices(procs);
  }

  console.log("Starting services: ", procs.map((p) => p.name).join(", "));

  const { result } = concurrently(procs, { killOthersOn: ["failure", "success"] });

  result
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

main();
