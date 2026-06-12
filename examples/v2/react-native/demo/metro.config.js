const path = require("path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const monorepoRoot = path.resolve(__dirname, "../../../..");

/**
 * Metro configuration for pnpm monorepo.
 *
 * pnpm uses symlinks in node_modules that resolve into the root
 * node_modules/.pnpm store. Metro needs watchFolders to cover both
 * the workspace packages and the root node_modules so it can follow
 * those symlinks. The resolveRequest override prevents Metro from
 * choking on node: built-in imports from server-only transitive deps.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    path.resolve(monorepoRoot, "packages", "core"),
    path.resolve(monorepoRoot, "packages", "shared"),
    path.resolve(monorepoRoot, "packages", "react-core"),
    path.resolve(monorepoRoot, "packages", "react-native"),
    path.resolve(monorepoRoot, "node_modules"),
  ],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, "node_modules"),
      path.resolve(monorepoRoot, "node_modules"),
    ],
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName.startsWith("node:")) {
        return { type: "empty" };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
