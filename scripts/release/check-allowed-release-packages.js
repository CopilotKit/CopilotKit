const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const allowedReleasePackages = new Set([
  "@copilotkit/a2ui-renderer",
  "@copilotkit/core",
  "@copilotkit/react-core",
  "@copilotkit/react-textarea",
  "@copilotkit/react-ui",
  "@copilotkit/runtime",
  "@copilotkit/runtime-client-gql",
  "@copilotkit/sdk-js",
  "@copilotkit/shared",
  "@copilotkit/sqlite-runner",
  "@copilotkit/voice",
  "@copilotkit/web-inspector",
  "@copilotkitnext/angular",
  "copilotkit",
]);

const statusFile = ".changeset-status.release-check.json";
const statusPath = path.join(process.cwd(), statusFile);

try {
  const result = spawnSync(
    "pnpm",
    ["changeset", "status", `--output=${statusFile}`],
    {
      cwd: process.cwd(),
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  const unexpectedReleases = status.releases.filter(
    (release) =>
      release.type !== "none" && !allowedReleasePackages.has(release.name),
  );

  if (unexpectedReleases.length > 0) {
    console.error("Unexpected release targets found:");
    for (const release of unexpectedReleases) {
      console.error(
        `- ${release.name} (${release.type} -> ${release.newVersion})`,
      );
    }
    process.exit(1);
  }

  console.log("Release plan only contains allowlisted packages.");
} finally {
  fs.rmSync(statusPath, { force: true });
}
