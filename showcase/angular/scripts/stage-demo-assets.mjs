import {
  access,
  cp,
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageSource = fileURLToPath(
  new URL("../../../packages/angular/dist/", import.meta.url),
);
const packageSourceCode = fileURLToPath(
  new URL("../../../packages/angular/src/", import.meta.url),
);
const packageDestination = fileURLToPath(
  new URL("../.staged-angular-package/", import.meta.url),
);
const packageNodeModules = fileURLToPath(
  new URL("../../../packages/angular/node_modules/", import.meta.url),
);
const hostNodeModules = fileURLToPath(
  new URL("../node_modules/", import.meta.url),
);
await rm(packageDestination, { recursive: true, force: true });
await cp(packageSource, packageDestination, { recursive: true });
await cp(packageSourceCode, `${packageDestination}/src`, { recursive: true });

const packageManifestPath = `${packageDestination}/package.json`;
const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
const peerNames = new Set(Object.keys(packageManifest.peerDependencies ?? {}));
for (const dependencyName of new Set([
  ...Object.keys(packageManifest.dependencies ?? {}),
  ...peerNames,
])) {
  const sourceRoot = peerNames.has(dependencyName)
    ? hostNodeModules
    : packageNodeModules;
  const source = join(sourceRoot, dependencyName);
  const destination = join(packageDestination, "node_modules", dependencyName);
  await mkdir(dirname(destination), { recursive: true });
  await symlink(source, destination, "dir");
}
packageManifest.main = "./src/index.ts";
packageManifest.module = "./src/index.ts";
packageManifest.types = "./src/index.ts";
packageManifest.exports = {
  ".": {
    types: "./src/index.ts",
    default: "./src/index.ts",
  },
  "./mcp-apps": {
    types: "./src/mcp-apps/index.ts",
    default: "./src/mcp-apps/index.ts",
  },
  "./styles.css": "./styles.css",
};
await writeFile(
  packageManifestPath,
  `${JSON.stringify(packageManifest, null, 2)}\n`,
);
await writeFile(
  `${packageDestination}/mcp-apps/package.json`,
  `${JSON.stringify(
    {
      type: "module",
      types: "../src/mcp-apps/index.ts",
      module: "../src/mcp-apps/index.ts",
    },
    null,
    2,
  )}\n`,
);

const sourceRoot = fileURLToPath(
  new URL(
    "../../integrations/langgraph-python/public/demo-files/",
    import.meta.url,
  ),
);
const destinationRoot = fileURLToPath(
  new URL("../public/demo-files/", import.meta.url),
);
const filenames = ["sample.png", "sample.pdf"];

await mkdir(destinationRoot, { recursive: true });
await Promise.all(
  filenames.map((filename) =>
    copyFile(`${sourceRoot}/${filename}`, `${destinationRoot}/${filename}`),
  ),
);

const sandboxProxyCandidates = [
  new URL(
    "../.staged-angular-package/mcp-apps/sandbox-proxy.html",
    import.meta.url,
  ),
  new URL(
    "../node_modules/@copilotkit/angular/dist/mcp-apps/sandbox-proxy.html",
    import.meta.url,
  ),
  new URL(
    "../node_modules/@copilotkit/angular/mcp-apps/sandbox-proxy.html",
    import.meta.url,
  ),
  new URL(
    "../../../packages/angular/src/mcp-apps/sandbox-proxy.html",
    import.meta.url,
  ),
];
let sandboxProxySource;
for (const candidate of sandboxProxyCandidates) {
  const candidateFile = fileURLToPath(candidate);
  try {
    await access(candidateFile);
    sandboxProxySource = candidateFile;
    break;
  } catch {
    // Clean consumers use the packed asset; workspace builds use the source.
  }
}
if (!sandboxProxySource) {
  throw new Error(
    "Could not find the packed or workspace MCP Apps sandbox proxy asset.",
  );
}
const sandboxProxyDestination = fileURLToPath(
  new URL("../public/mcp-apps-sandbox.html", import.meta.url),
);
await copyFile(sandboxProxySource, sandboxProxyDestination);

const generatedRoot = fileURLToPath(
  new URL("../src/app/generated/", import.meta.url),
);
await mkdir(generatedRoot, { recursive: true });
await Promise.all([
  copyFile(
    fileURLToPath(
      new URL("../../shared/frontend-registry.json", import.meta.url),
    ),
    `${generatedRoot}/frontend-registry.json`,
  ),
  copyFile(
    fileURLToPath(
      new URL("../../shell/src/data/frontend-catalog.json", import.meta.url),
    ),
    `${generatedRoot}/frontend-catalog.json`,
  ),
]);
