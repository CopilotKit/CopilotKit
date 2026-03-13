const path = require("path");

/**
 * When COPILOTKIT_LOCAL is set, rewrites CopilotKit dependencies to link
 * against the local monorepo packages instead of pulling from npm.
 *
 * Usage:
 *   COPILOTKIT_LOCAL=1 pnpm install   # link to local packages
 *   pnpm install                       # install from npm (default)
 */

const COPILOTKIT_ROOT = path.resolve(__dirname, "..", "..", "..");

const LOCAL_PACKAGES = {
  "@copilotkit/react-core": path.join(
    COPILOTKIT_ROOT,
    "packages/v1/react-core",
  ),
  "@copilotkit/react-ui": path.join(COPILOTKIT_ROOT, "packages/v1/react-ui"),
  "@copilotkit/runtime": path.join(COPILOTKIT_ROOT, "packages/v1/runtime"),
  "@copilotkitnext/shared": path.join(COPILOTKIT_ROOT, "packages/v2/shared"),
};

function readPackage(pkg) {
  if (process.env.COPILOTKIT_LOCAL) {
    for (const [name, localPath] of Object.entries(LOCAL_PACKAGES)) {
      if (pkg.dependencies?.[name]) {
        pkg.dependencies[name] = `link:${localPath}`;
      }
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
