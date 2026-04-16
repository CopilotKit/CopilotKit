const path = require("path");

/**
 * When COPILOTKIT_LOCAL is set, rewrites CopilotKit and AG-UI dependencies
 * to link against local monorepo packages instead of pulling from npm.
 *
 * Usage:
 *   COPILOTKIT_LOCAL=1 pnpm install   # link to local packages
 *   pnpm install                       # install from npm (default)
 *
 * Expects the AG-UI repo to be cloned alongside CopilotKit:
 *   /some/path/CopilotKit/
 *   /some/path/ag-ui/
 */

const COPILOTKIT_ROOT = path.resolve(__dirname, "..", "..", "..");
const AGUI_ROOT = path.resolve(COPILOTKIT_ROOT, "..", "ag-ui");

const LOCAL_PACKAGES = {
  // CopilotKit
  "@copilotkit/react-core": path.join(COPILOTKIT_ROOT, "packages/react-core"),
  "@copilotkit/react-ui": path.join(COPILOTKIT_ROOT, "packages/react-ui"),
  "@copilotkit/runtime": path.join(COPILOTKIT_ROOT, "packages/runtime"),
  "@copilotkit/shared": path.join(COPILOTKIT_ROOT, "packages/shared"),
  "@copilotkit/a2ui-renderer": path.join(
    COPILOTKIT_ROOT,
    "packages/a2ui-renderer",
  ),
  // AG-UI
  "@ag-ui/client": path.join(AGUI_ROOT, "sdks/typescript/packages/client"),
  "@ag-ui/core": path.join(AGUI_ROOT, "sdks/typescript/packages/core"),
  "@ag-ui/encoder": path.join(AGUI_ROOT, "sdks/typescript/packages/encoder"),
  "@ag-ui/proto": path.join(AGUI_ROOT, "sdks/typescript/packages/proto"),
  "@ag-ui/a2ui-middleware": path.join(AGUI_ROOT, "middlewares/a2ui-middleware"),
  "@ag-ui/mcp-apps-middleware": path.join(
    AGUI_ROOT,
    "middlewares/mcp-apps-middleware",
  ),
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
