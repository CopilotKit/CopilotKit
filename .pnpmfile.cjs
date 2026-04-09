const path = require("path");
const fs = require("fs");

/**
 * When A2UI_LOCAL=1, rewrites @a2ui/* dependencies to link against
 * locally-built packages from the sibling A2UI repo.
 *
 * Usage:
 *   A2UI_LOCAL=1 pnpm install   # link to local A2UI packages
 *   pnpm install                 # install from npm (default)
 *
 * Expects:
 *   /some/path/CopilotKit/  (this repo)
 *   /some/path/A2UI/        (sibling A2UI repo)
 */

const A2UI_ROOT = path.resolve(__dirname, "..", "A2UI");

const A2UI_PACKAGES = {
  "@a2ui/web_core": "renderers/web_core",
  "@a2ui/react": "renderers/react",
};

function readPackage(pkg) {
  if (!process.env.A2UI_LOCAL) return pkg;

  for (const [dep, relPath] of Object.entries(A2UI_PACKAGES)) {
    if (pkg.dependencies && pkg.dependencies[dep]) {
      const localPath = path.join(A2UI_ROOT, relPath);
      if (fs.existsSync(localPath)) {
        pkg.dependencies[dep] = `link:${localPath}`;
      }
    }
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
