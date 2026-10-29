import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = join(root, "flutter");
const sdk = join(app, ".sdk");
const revision = "1f6006c270563fc305664bae30af975ba464d20b";

/** Runs a setup command with its normal terminal output. */
function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

const requirements =
  "Flutter 3.47.0 or later (before 4.0) with Dart 3.13.0 or later (before 4.0)";
const recovery =
  "Run flutter upgrade, then flutter --version. If you use FVM, run fvm install 3.47.0 and put that SDK's bin directory on PATH. Retry npm run setup:flutter from the app root.";

/** Checks a stable SDK version against this template's Dart 3 / Flutter 3 floor. */
function supported(version, minor) {
  if (typeof version !== "string") return false;
  const match = /^(3)\.(\d+)\.(\d+)(?:\s.*)?$/.exec(version);
  return match !== null && Number(match[2]) >= minor;
}

/** Checks the Flutter executable used by pub before changing the SDK checkout. */
function checkFlutter() {
  let version;
  try {
    version = JSON.parse(
      execFileSync("flutter", ["--version", "--machine"], {
        cwd: app,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      }),
    );
  } catch {
    throw new Error(
      `Could not read Flutter's version. Install ${requirements} and put flutter on PATH. ${recovery}`,
    );
  }
  if (
    !supported(version?.frameworkVersion, 47) ||
    !supported(version?.dartSdkVersion, 13)
  ) {
    throw new Error(
      `Found Flutter ${version?.frameworkVersion ?? "unknown"} / Dart ${version?.dartSdkVersion ?? "unknown"}. This template and its pinned CopilotKit Flutter SDK require ${requirements}. ${recovery}`,
    );
  }
}

/** Prepares the pinned SDK only after the local Flutter toolchain passes. */
function main() {
  checkFlutter();
  if (!existsSync(sdk)) {
    run("git", [
      "clone",
      "https://github.com/VGVentures/copilotkit_flutter_sdk.git",
      sdk,
    ]);
  }
  const actual = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sdk,
    encoding: "utf8",
  }).trim();
  if (actual !== revision) run("git", ["checkout", "--detach", revision], sdk);

  // The generated app is the workspace root. The pinned SDK packages are members.
  rmSync(join(sdk, "pubspec.yaml"), { force: true });
  rmSync(join(sdk, "pubspec.lock"), { force: true });

  run("flutter", ["pub", "get"], app);
  console.log(
    "Flutter app ready. Run flutter run with RUNTIME_URL from the README.",
  );
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Flutter setup failed.",
  );
  process.exitCode = 1;
}
