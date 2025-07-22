#!/usr/bin/env node

/**
 * Simple validation script to test the E2E setup
 */

const { spawn } = require("child_process");
const fs = require("fs");

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(" ")}`);

    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      ...options,
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

async function validateSetup() {
  try {
    console.log("🔍 Validating E2E Setup...\n");

    // Test 1: Check script exists and is executable
    console.log("1. Checking startup script...");
    if (!fs.existsSync("./scripts/start-test-apps.sh")) {
      throw new Error("Startup script not found!");
    }

    const stats = fs.statSync("./scripts/start-test-apps.sh");
    if (!(stats.mode & parseInt("755", 8))) {
      throw new Error("Startup script is not executable!");
    }
    console.log("✅ Startup script found and executable\n");

    // Test 2: List available apps
    console.log("2. Listing available apps...");
    await runCommand("./scripts/start-test-apps.sh", ["--list"]);
    console.log("✅ App discovery working\n");

    // Test 3: Check environment variable output
    console.log("3. Testing environment variable output...");
    await runCommand("./scripts/start-test-apps.sh", [
      "--print-env",
      "research-canvas",
    ]);
    console.log("✅ Environment variable generation working\n");

    // Test 4: Check test files exist
    console.log("4. Checking test files...");
    const testFiles = [
      "./tests/research-canvas.spec.ts",
      "./tests/qa-text.spec.ts",
    ];

    for (const file of testFiles) {
      if (!fs.existsSync(file)) {
        throw new Error(`Test file ${file} not found!`);
      }
    }
    console.log("✅ Test files found\n");

    // Test 5: Check package.json scripts
    console.log("5. Checking package.json scripts...");
    const pkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));
    const requiredScripts = ["start-apps", "list-apps", "test"];

    for (const script of requiredScripts) {
      if (!pkg.scripts[script]) {
        throw new Error(`Script '${script}' not found in package.json!`);
      }
    }
    console.log("✅ Package.json scripts configured\n");

    console.log("🎉 All validation checks passed!");
    console.log("\nNext steps:");
    console.log("1. Export OPENAI_API_KEY=your-key");
    console.log("2. Run: pnpm start-apps");
    console.log("3. In another terminal: pnpm test");
  } catch (error) {
    console.error("❌ Validation failed:", error.message);
    process.exit(1);
  }
}

validateSetup();
