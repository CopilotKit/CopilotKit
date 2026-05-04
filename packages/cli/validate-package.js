// validate-package.js
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

console.log("1. Cleaning...");
execSync("pnpm run clean", { stdio: "inherit" });

console.log("\n2. Building...");
execSync("pnpm run build", { stdio: "inherit" });

console.log("\n3. Checking dist directory...");
const distPath = path.join(process.cwd(), "dist");
if (!fs.existsSync(distPath)) {
  console.error("❌ dist directory does not exist!");
  process.exit(1);
}

const distFiles = fs.readdirSync(distPath, { recursive: true });
console.log("dist directory contents:", distFiles);

console.log("\n4. Generating manifest...");
execSync("oclif manifest", { stdio: "inherit" });

console.log("\n5. Checking manifest...");
const manifestPath = path.join(process.cwd(), "oclif.manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("❌ oclif.manifest.json does not exist!");
  process.exit(1);
}

console.log("\n6. Creating pack...");
execSync("npm pack --dry-run", { stdio: "inherit" });
