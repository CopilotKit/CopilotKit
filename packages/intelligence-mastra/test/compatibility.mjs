#!/usr/bin/env node
import {
  verifyNativeReport,
  monitorPlan,
  monitorOutput,
  prepareMonitorConsumer,
  installMonitorConsumer,
} from "../../../tools/compatibility-monitor/typescript.mjs";
const monitor = monitorPlan();
const monitorArtifacts = monitorOutput();
// Run after the package and canonical runtime have been built through Nx.
// Every install and test copy lives in a temporary standalone consumer.
import assert from "node:assert/strict";
import {
  packRuntimeWorkspace,
  standaloneConsumerEnv,
} from "../../../tools/learned-skill-conformance/workspace-artifacts.mjs";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const consumerEnv = {
  ...standaloneConsumerEnv(),
  COPILOTKIT_TELEMETRY_DISABLED: "true",
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");
const coreRoot = resolve(packageRoot, "../intelligence-delivery-core");
const laneIndex = process.argv.indexOf("--lane");
const selectedLane = laneIndex === -1 ? undefined : process.argv[laneIndex + 1];
if (selectedLane && !["minimum", "latest"].includes(selectedLane))
  throw new Error("Expected --lane minimum or --lane latest");
const work = mkdtempSync(join(tmpdir(), "mastra-skills-compat-"));
const artifacts = join(work, "artifacts");
mkdirSync(artifacts);
console.log(`Standalone compatibility consumers: ${work}`);
const manifest = (root) =>
  JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
function pack(root) {
  const pkg = manifest(root);
  execFileSync("pnpm", ["pack", "--pack-destination", artifacts], {
    cwd: root,
    stdio: "pipe",
  });
  return join(
    artifacts,
    `${pkg.name.replace(/^@/, "").replaceAll("/", "-")}-${pkg.version}.tgz`,
  );
}
// The private workspace implementation must be fully included in the package.
assert.equal(
  manifest(packageRoot).dependencies?.[
    "@copilotkit/intelligence-delivery-core"
  ],
  undefined,
);
for (const file of monitor?.track === "published"
  ? []
  : readdirSync(join(packageRoot, "dist"), {
      recursive: true,
    })) {
  if (!/\.(?:mjs|cjs|js|d\.ts|d\.mts|d\.cts)$/.test(file)) continue;
  assert.doesNotMatch(
    readFileSync(join(packageRoot, "dist", file), "utf8"),
    /["']@copilotkit\/intelligence-delivery-core(?:\/[^"']*)?["']/,
    `Private core package reference remains in ${file}`,
  );
}
const adapter =
  monitor?.track === "published" ? monitor.adapterVersion : pack(packageRoot);
const runtimeWorkspace =
  monitor?.track === "published"
    ? {
        dependencies: { "@copilotkit/runtime": monitor.adapterVersion },
        overrides: {},
      }
    : packRuntimeWorkspace(workspaceRoot, artifacts);
const lanes = {
  minimum: { "@mastra/core": "1.0.0", zod: "3.25.76" },
  latest: manifest(packageRoot).peerDependencies,
};
const smoke = `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('@copilotkit/intelligence-delivery-core'), e => e.code === 'MODULE_NOT_FOUND');
const load = process.argv[2] === 'require' ? async s => require(s) : s => import(s);
const { SkillRegistry, SkillDeliveryError, createSkillRegistryProcessor } = await load('@copilotkit/intelligence-mastra');
const { CopilotKitIntelligence } = await load('@copilotkit/runtime/v2');
const { zipSync, strToU8 } = await load('fflate');
const bytes = zipSync({'manifest.json':strToU8(JSON.stringify({schemaVersion:1,revision:'A',skills:[]}))});
const client = new CopilotKitIntelligence({apiKey:'local-test'});
client.getLearnedSkillsSnapshot = async () => ({status:'snapshot',bytes,revision:'A',etag:'"'+createHash('sha256').update(bytes).digest('hex')+'"',contentType:'application/zip'});
const registry = new SkillRegistry({client,containerId:'local'});
await registry.initialize();
assert.equal(registry.status.revision,'A');
const skills = createSkillRegistryProcessor({registry});
assert.deepEqual(Object.keys(skills.tools),['copilotkit_load_skill','copilotkit_read_skill_file']);
assert.throws(() => skills.wrapAgent({}), e => e instanceof SkillDeliveryError && e.code === 'INVALID_CONFIG');
console.log(process.argv[2] + ': independent package initialization and native tool registration passed');
`;
const types = `import { Agent } from '@mastra/core/agent';
import { SkillRegistry, createSkillRegistryProcessor } from '@copilotkit/intelligence-mastra';
const skills = createSkillRegistryProcessor({registry:new SkillRegistry()});
const native = new Agent({id:'typed',name:'Typed',model:'openai/gpt-4.1',instructions:'Help',inputProcessors:[skills],tools:skills.tools});
const agent: typeof native = skills.wrapAgent(native);
async function inference() {
 const result = await agent.generate('Help');
 const text: string = result.text;
 // @ts-expect-error Preserve native result types.
 const invalid: number = result.text;
 return {text,invalid};
}
void inference;
`;

for (const [lane, peers] of Object.entries(
  monitor
    ? {
        exact: monitor.dependencies,
      }
    : lanes,
)) {
  if (selectedLane && selectedLane !== lane) continue;
  const cwd = join(work, lane);
  mkdirSync(cwd);
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: `skills-compat-${lane}`,
        private: true,
        type: "module",
        overrides: runtimeWorkspace.overrides,
        dependencies: {
          ...peers,
          "@copilotkit/intelligence-mastra":
            monitor?.track === "published" ? adapter : `file:${adapter}`,
          ...runtimeWorkspace.dependencies,
          typescript: "5.8.2",
          "@types/node": "22.15.3",
          fflate: "0.8.2",
          vitest: "4.1.11",
        },
      },
      null,
      2,
    ),
  );
  installMonitorConsumer(monitor, cwd, consumerEnv, monitorArtifacts);
  writeFileSync(join(cwd, "smoke.mjs"), smoke);
  writeFileSync(join(cwd, "types.mts"), types);
  writeFileSync(join(cwd, "types.cts"), types);
  writeFileSync(
    join(cwd, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["types.mts", "types.cts"],
    }),
  );
  for (const folder of ["src"])
    cpSync(join(packageRoot, folder), join(cwd, folder), { recursive: true });
  writeFileSync(
    join(cwd, "src/index.ts"),
    'export * from "@copilotkit/intelligence-mastra";\n',
  );
  // Source suites resolve the private workspace core from a test-only copy.
  // Installed-distribution smoke tests use no private package.
  cpSync(join(coreRoot, "src"), join(cwd, "delivery-core/src"), {
    recursive: true,
  });
  cpSync(
    join(coreRoot, "conformance"),
    join(cwd, "delivery-core/conformance"),
    { recursive: true },
  );
  writeFileSync(
    join(cwd, "vitest.config.mts"),
    'import { defineConfig } from "vitest/config"; import { fileURLToPath } from "node:url"; export default defineConfig({resolve:{alias:{"@copilotkit/intelligence-delivery-core":fileURLToPath(new URL("./delivery-core/src/index.ts",import.meta.url))}},test:{environment:"node",include:["src/**/__tests__/**/*.test.ts","delivery-core/src/**/__tests__/**/*.test.ts"],maxWorkers:2,env:{COPILOTKIT_TELEMETRY_DISABLED:"true"}}});',
  );
  prepareMonitorConsumer(monitor, cwd, packageRoot);
  for (const args of [
    ["smoke.mjs", "import"],
    ["smoke.mjs", "require"],
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      ...(monitor
        ? [
            "--reporter=json",
            `--outputFile=${join(monitorArtifacts, "native-results.json")}`,
          ]
        : []),
    ],
  ]) {
    execFileSync(process.execPath, args, {
      cwd,
      stdio: "inherit",
      env: consumerEnv,
    });
  }
  if (monitor)
    verifyNativeReport(
      JSON.parse(
        readFileSync(join(monitorArtifacts, "native-results.json"), "utf8"),
      ),
    );
  console.log(
    `${lane}: installed distribution, ESM/CJS inference, and native suites passed`,
  );
}
