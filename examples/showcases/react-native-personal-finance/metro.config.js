const path = require("path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */

// `@copilotkit/react-native`'s prebuilt UI components (file attachments,
// streaming markdown) statically import these native modules from the
// package's main entry. They are declared as *optional* peer dependencies and
// are NOT needed for the headless provider + hooks flow that this app uses
// (see https://docs.copilotkit.ai/react-native). We resolve them to an empty
// module so Metro can bundle without pulling Expo into this bare RN app.
//
// To use the prebuilt components instead, install the real packages
// (`npx install-expo-modules@latest`, then
// `npx expo install expo-document-picker expo-file-system` and
// `npm i react-native-streamdown react-native-gesture-handler react-native-reanimated @gorhom/bottom-sheet`)
// and remove the matching names from STUBBED_OPTIONAL_DEPS below.
const STUBBED_OPTIONAL_DEPS = new Set([
  "expo-document-picker",
  "expo-file-system",
  "react-native-streamdown",
]);

// The CopilotKit runtime is a SEPARATE Next.js app living in ./runtime. Metro
// watches the whole project root, so the Next.js dev server's constant writes
// to runtime/.next (and the large runtime/node_modules) trip Metro's file
// watcher in a loop — the app then shows a perpetual "Refreshing…" dev banner
// and re-bundles endlessly. Exclude the entire runtime/ subtree from Metro.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RUNTIME_DIR = path.join(__dirname, "runtime");
const runtimeBlock = new RegExp(`^${escapeRegExp(RUNTIME_DIR)}[\\\\/].*$`);

const config = {
  resolver: {
    blockList: runtimeBlock,
    unstable_enablePackageExports: true,
    resolveRequest: (context, moduleName, platform) => {
      if (STUBBED_OPTIONAL_DEPS.has(moduleName)) {
        return { type: "empty" };
      }
      // `jose` (transitive JWT dep) ships a Node build whose code imports
      // `node:buffer`. Steer ONLY jose to its `browser` build by adding the
      // `browser` condition for this module alone. Do NOT add `browser`
      // globally — that makes React Native's own core DOM setup resolve to the
      // wrong variant and crashes init ("setUpDOM().default is not a function").
      // The browser build relies on Web Crypto / TextEncoder (polyfilled).
      if (moduleName === "jose" || moduleName.startsWith("jose/")) {
        return context.resolveRequest(
          {
            ...context,
            unstable_conditionNames: ["browser", "require", "import"],
          },
          moduleName,
          platform,
        );
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
