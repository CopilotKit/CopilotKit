import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fixtureRoot = mkdtempSync(
  join(tmpdir(), "copilotkit-react-native-metro-"),
);
const packageOutput = join(fixtureRoot, "packages");
const appRoot = join(fixtureRoot, "app");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: "pipe",
    ...options,
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
}

function collectSources(sourceMap) {
  return [
    ...(sourceMap.sources ?? []),
    ...(sourceMap.sections ?? []).flatMap((section) =>
      collectSources(section.map),
    ),
  ];
}

try {
  mkdirSync(packageOutput, { recursive: true });
  mkdirSync(appRoot, { recursive: true });

  const workspacePackages = [
    "packages/shared",
    "packages/core",
    "packages/react-core",
    "packages/react-native",
  ];
  const tarballs = workspacePackages.map((workspacePackage) => {
    const output = run("pnpm", ["pack", "--pack-destination", packageOutput], {
      cwd: join(repositoryRoot, workspacePackage),
    });
    const tarball = output.split("\n").at(-1);
    return isAbsolute(tarball) ? tarball : join(packageOutput, tarball);
  });

  writeFileSync(
    join(appRoot, "package.json"),
    JSON.stringify({ name: "bare-metro-smoke", private: true }, null, 2),
  );
  writeFileSync(
    join(appRoot, "babel.config.js"),
    "module.exports = { presets: ['module:@react-native/babel-preset'] };\n",
  );
  writeFileSync(
    join(appRoot, "metro.config.js"),
    [
      'const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");',
      "module.exports = mergeConfig(getDefaultConfig(__dirname), {});",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(appRoot, "app.json"),
    JSON.stringify({ name: "BareMetroSmoke", displayName: "BareMetroSmoke" }),
  );
  writeFileSync(
    join(appRoot, "App.js"),
    [
      'import React from "react";',
      'import { Text, View } from "react-native";',
      'import { CopilotKitProvider } from "@copilotkit/react-native/headless";',
      "",
      "export default function App() {",
      "  return React.createElement(",
      "    CopilotKitProvider,",
      "    { runtimeUrl: 'http://localhost:4000/copilotkit' },",
      "    React.createElement(View, null, React.createElement(Text, null, 'CopilotKit')),",
      "  );",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(appRoot, "index.js"),
    [
      'import "react-native-get-random-values";',
      'import "@copilotkit/react-native/polyfills";',
      'import { AppRegistry } from "react-native";',
      'import App from "./App";',
      'import { name as appName } from "./app.json";',
      "",
      "AppRegistry.registerComponent(appName, () => App);",
      "",
    ].join("\n"),
  );

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "react@19.2.3",
      "react-dom@19.2.3",
      "react-native@0.87.1",
      "react-native-get-random-values@1.11.0",
      "zod@4.5.1",
      "@react-native-community/cli@20.2.0",
      "@react-native-community/cli-platform-android@20.2.0",
      "@react-native/babel-preset@0.87.1",
      "@react-native/metro-config@0.87.1",
      ...tarballs,
    ],
    { cwd: appRoot },
  );

  const bundlePath = join(appRoot, "index.android.bundle");
  const sourceMapPath = join(appRoot, "index.android.bundle.map");
  run(
    join(appRoot, "node_modules/.bin/react-native"),
    [
      "bundle",
      "--platform",
      "android",
      "--dev",
      "false",
      "--entry-file",
      "index.js",
      "--bundle-output",
      bundlePath,
      "--sourcemap-output",
      sourceMapPath,
    ],
    { cwd: appRoot },
  );

  const sourceMap = JSON.parse(readFileSync(sourceMapPath, "utf8"));
  const sources = collectSources(sourceMap).map((source) =>
    source.replaceAll("\\", "/"),
  );
  const requiredSource = "@copilotkit/shared/dist/react-native.mjs";
  if (!sources.some((source) => source.includes(requiredSource))) {
    throw new Error(`Metro did not resolve ${requiredSource}`);
  }

  const forbiddenSources = [
    "@copilotkit/shared/dist/index.mjs",
    "@segment/analytics-node",
    "/jose/",
    "/app/node_modules/zod/index.js",
    "/app/node_modules/zod/index.cjs",
    "expo-document-picker",
    "expo-file-system",
  ];
  for (const forbiddenSource of forbiddenSources) {
    const matchedSource = sources.find((source) =>
      source.includes(forbiddenSource),
    );
    if (matchedSource) {
      throw new Error(`Metro bundled forbidden source: ${matchedSource}`);
    }
  }

  console.log("PASS: stock Metro bundled @copilotkit/react-native/headless");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
