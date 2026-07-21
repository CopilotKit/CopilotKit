import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConsumerWorkspaceYaml } from "./lib/channels-umbrella.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME_DIR = join(ROOT, "packages", "runtime");
const CHANNELS_INTELLIGENCE = "@copilotkit/channels-intelligence";
const AGUI_LANGGRAPH_PATCH = join(ROOT, "patches", "@ag-ui__langgraph.patch");

interface PackageManifest {
  name: string;
  version: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const LANGGRAPH_SDK_VERSIONS = ["1.8.8", "1.8.9"] as const;

function capture(command: string, args: string[], cwd = ROOT): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, CI: "true" },
  });
}

function run(command: string, args: string[], cwd = ROOT): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function tarballName(manifest: PackageManifest): string {
  return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

function packageDirectory(name: string): string {
  return join(ROOT, "packages", name.replace("@copilotkit/", ""));
}

function packPackage(
  packageDir: string,
  tarballDir: string,
): { manifest: PackageManifest; tarball: string } {
  const source = readJson<PackageManifest>(join(packageDir, "package.json"));
  capture("pnpm", ["pack", "--pack-destination", tarballDir], packageDir);
  const tarball = join(tarballDir, tarballName(source));
  const manifest = JSON.parse(
    capture("tar", ["-xOf", tarball, "package/package.json"]),
  ) as PackageManifest;
  return { manifest, tarball };
}

function packWorkspaceDependencyClosure(
  rootManifest: PackageManifest,
  tarballDir: string,
): Map<string, string> {
  const tarballs = new Map<string, string>();
  const seen = new Set<string>([rootManifest.name]);
  const queue = [rootManifest];

  while (queue.length) {
    const manifest = queue.shift();
    if (!manifest) break;
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (!name.startsWith("@copilotkit/") || !range.startsWith("workspace:")) {
        continue;
      }
      if (seen.has(name)) continue;
      seen.add(name);

      const packageDir = packageDirectory(name);
      const packed = packPackage(packageDir, tarballDir);
      tarballs.set(name, packed.tarball);
      queue.push(readJson<PackageManifest>(join(packageDir, "package.json")));
    }
  }

  return tarballs;
}

function assertDeclarationContract(tarball: string): void {
  const declarationFiles = capture("tar", ["-tf", tarball])
    .split("\n")
    .filter((file) => /\.d\.[cm]?ts$/.test(file));
  const commonJsDeclarations = declarationFiles.filter((file) =>
    file.endsWith(".d.cts"),
  );
  if (!commonJsDeclarations.length) {
    throw new Error("packed runtime has no CommonJS declarations");
  }

  for (const file of declarationFiles) {
    const declaration = capture("tar", ["-xOf", tarball, file]);
    if (file.endsWith(".d.cts") && /^\s*require\s*\(/m.test(declaration)) {
      throw new Error(`${file} contains an executable require statement`);
    }
    if (/from ["']@langchain\/langgraph-sdk\/dist\//.test(declaration)) {
      throw new Error(
        `${file} imports a private LangGraph SDK declaration path`,
      );
    }
  }
}

function verifyLangGraphConsumer(
  consumerDir: string,
  sdkVersion: (typeof LANGGRAPH_SDK_VERSIONS)[number],
  rootManifest: PackageManifest,
  runtimeManifest: PackageManifest,
  runtimeTarball: string,
  localTarballs: Map<string, string>,
): void {
  const typescript = rootManifest.devDependencies?.typescript;
  const nodeTypes = rootManifest.devDependencies?.["@types/node"];
  const aguiLangGraph = runtimeManifest.dependencies?.["@ag-ui/langgraph"];
  if (!typescript || !nodeTypes || !aguiLangGraph) {
    throw new Error("missing packed-consumer type dependencies");
  }

  mkdirSync(consumerDir);
  mkdirSync(join(consumerDir, "patches"));
  copyFileSync(
    AGUI_LANGGRAPH_PATCH,
    join(consumerDir, "patches", "@ag-ui__langgraph.patch"),
  );
  writeFileSync(
    join(consumerDir, "pnpm-workspace.yaml"),
    `${createConsumerWorkspaceYaml()}patchedDependencies:\n  "@ag-ui/langgraph@0.0.42": patches/@ag-ui__langgraph.patch\n`,
  );
  writeFileSync(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: `runtime-package-consumer-sdk-${sdkVersion}`,
        version: "0.0.0",
        private: true,
        type: "module",
        packageManager: rootManifest.packageManager,
        dependencies: {
          "@ag-ui/langgraph": aguiLangGraph,
          "@copilotkit/runtime": `file:${runtimeTarball}`,
          "@langchain/core": "1.1.42",
          "@langchain/langgraph-sdk": sdkVersion,
        },
        devDependencies: {
          "@types/node": nodeTypes,
          typescript,
        },
        pnpm: {
          overrides: Object.fromEntries(
            [...localTarballs].map(([name, localTarball]) => [
              name,
              `file:${localTarball}`,
            ]),
          ),
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumerDir, ".npmrc"),
    "auto-install-peers=false\nstrict-peer-dependencies=false\n",
  );
  writeFileSync(
    join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2023", "DOM"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: false,
          noEmit: true,
        },
        include: ["strict-esm.mts", "strict-cjs.cts"],
      },
      null,
      2,
    )}\n`,
  );

  const source = `import {
  LangGraphAgent,
  LangGraphHttpAgent,
} from "@copilotkit/runtime/langgraph";
import { LangGraphAgent as UpstreamLangGraphAgent } from "@ag-ui/langgraph";
import { Client } from "@langchain/langgraph-sdk";

const client = new Client({ apiUrl: "http://localhost:8000" });
const agent = new LangGraphAgent({
  client,
  graphId: "strict-consumer",
  deploymentUrl: "http://localhost:8000",
});
const clone: LangGraphAgent = agent.clone();
const upstream: UpstreamLangGraphAgent = agent;
const httpAgent: LangGraphHttpAgent = new LangGraphHttpAgent({
  url: "http://localhost:8000",
});
const events = agent.run({
  runId: "run-1",
  threadId: "thread-1",
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
});
void clone;
void upstream;
void httpAgent;
void events;
`;
  writeFileSync(join(consumerDir, "strict-esm.mts"), source);
  writeFileSync(join(consumerDir, "strict-cjs.cts"), source);

  run("pnpm", ["install", "--ignore-scripts"], consumerDir);
  run("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], consumerDir);
  run(
    "pnpm",
    [
      "exec",
      "node",
      "--eval",
      `const { LangGraphHttpAgent } = require("@copilotkit/runtime/langgraph");
const agent = new LangGraphHttpAgent({ url: "http://localhost:8000" });
if (!(agent instanceof LangGraphHttpAgent)) throw new Error("CJS HTTP agent construction failed");`,
    ],
    consumerDir,
  );
  run(
    "pnpm",
    [
      "exec",
      "node",
      "--input-type=module",
      "--eval",
      `const { LangGraphHttpAgent } = await import("@copilotkit/runtime/langgraph");
const agent = new LangGraphHttpAgent({ url: "http://localhost:8000" });
if (!(agent instanceof LangGraphHttpAgent)) throw new Error("ESM HTTP agent construction failed");`,
    ],
    consumerDir,
  );
}

function main(): void {
  const rootManifest = readJson<PackageManifest>(join(ROOT, "package.json"));
  const runtimeManifest = readJson<PackageManifest>(
    join(RUNTIME_DIR, "package.json"),
  );
  if (!rootManifest.packageManager) {
    throw new Error("root package.json is missing packageManager");
  }

  const temp = mkdtempSync(join(tmpdir(), "runtime-package-"));
  const tarballDir = join(temp, "tarballs");
  mkdirSync(tarballDir);

  try {
    const { manifest: packedManifest, tarball } = packPackage(
      RUNTIME_DIR,
      tarballDir,
    );
    if (!packedManifest.dependencies?.[CHANNELS_INTELLIGENCE]) {
      throw new Error(
        `packed runtime must install ${CHANNELS_INTELLIGENCE} as a dependency`,
      );
    }
    assertDeclarationContract(tarball);
    const localTarballs = packWorkspaceDependencyClosure(
      runtimeManifest,
      tarballDir,
    );

    for (const sdkVersion of LANGGRAPH_SDK_VERSIONS) {
      verifyLangGraphConsumer(
        join(temp, `consumer-sdk-${sdkVersion}`),
        sdkVersion,
        rootManifest,
        runtimeManifest,
        tarball,
        localTarballs,
      );
    }
    if (
      packedManifest.peerDependencies?.["@langchain/langgraph-sdk"] !== "^1.8.8"
    ) {
      throw new Error(
        "packed runtime must support LangGraph SDK ^1.8.8 as a peer dependency",
      );
    }
    if (packedManifest.dependencies?.["@langchain/langgraph-sdk"]) {
      throw new Error(
        "packed runtime must not install a second nominal LangGraph SDK Client",
      );
    }

    run(
      "pnpm",
      [
        "exec",
        "node",
        "--eval",
        `require("@copilotkit/runtime");
require("@copilotkit/runtime/v2");`,
      ],
      join(temp, `consumer-sdk-${LANGGRAPH_SDK_VERSIONS.at(-1)}`),
    );
    run(
      "pnpm",
      [
        "exec",
        "node",
        "--experimental-import-meta-resolve",
        "--input-type=module",
        "--eval",
        `const runtimePackageUrl = import.meta.resolve("@copilotkit/runtime/package.json");
const channelsIntelligenceUrl = import.meta.resolve(
  "${CHANNELS_INTELLIGENCE}",
  runtimePackageUrl,
);
await import(channelsIntelligenceUrl);`,
      ],
      join(temp, `consumer-sdk-${LANGGRAPH_SDK_VERSIONS.at(-1)}`),
    );

    console.log(
      `OK: packed runtime installs ${CHANNELS_INTELLIGENCE}, accepts LangGraph SDK ${LANGGRAPH_SDK_VERSIONS.join(" and ")} clients in strict ESM/CJS NodeNext consumers, and loads through ESM and CJS.`,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
