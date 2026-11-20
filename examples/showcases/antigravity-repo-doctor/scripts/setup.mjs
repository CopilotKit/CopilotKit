// Runs before `pnpm dev`: creates .env, installs the agent, and checks the Gemini key.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";

const fail = (message) => {
  console.error(`\nsetup: ${message}\n`);
  process.exit(1);
};

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("setup: created .env from .env.example");
}

try {
  execFileSync("uv", ["--version"], { stdio: "ignore" });
} catch {
  fail(
    "uv is not installed. Install it from https://docs.astral.sh/uv/ and run pnpm dev again.",
  );
}

try {
  execFileSync("uv", ["sync", "--quiet"], { cwd: "agent", stdio: "inherit" });
} catch {
  fail("uv sync failed in agent/. See the error above.");
}

const keyLine = readFileSync(".env", "utf8")
  .split("\n")
  .find((line) => line.startsWith("GEMINI_API_KEY="));
const keyInFile = (keyLine ?? "")
  .slice("GEMINI_API_KEY=".length)
  .trim()
  .replace(/^["']|["']$/g, "");
if (!process.env.GEMINI_API_KEY && !keyInFile) {
  fail(
    "GEMINI_API_KEY is empty. Get one at https://aistudio.google.com/apikey, add it to .env and run pnpm dev again.",
  );
}
