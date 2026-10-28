import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = join(root, "flutter");
const sdk = join(app, ".sdk");
const revision = "1f6006c270563fc305664bae30af975ba464d20b";

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

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
