#!/usr/bin/env node
// Run after the package and canonical runtime have been built through Nx.
// Every install and test copy lives in a temporary standalone consumer.
import assert from "node:assert/strict";
import {
  monitorPlan,
  monitorOutput,
  prepareMonitorConsumer,
  installMonitorConsumer,
} from "../../../tools/compatibility-monitor/typescript.mjs";
const monitor = monitorPlan();
const monitorArtifacts = monitorOutput();
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

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");
const coreRoot = resolve(packageRoot, "../intelligence-delivery-core");
const laneIndex = process.argv.indexOf("--lane");
const selectedLane = laneIndex === -1 ? undefined : process.argv[laneIndex + 1];
if (selectedLane && !["minimum", "latest"].includes(selectedLane))
  throw new Error("Expected --lane minimum or --lane latest");
const work = mkdtempSync(join(tmpdir(), "learned-skills-compat-"));
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
const runtime =
  monitor?.track === "published"
    ? {
        dependencies: { "@copilotkit/runtime": monitor.adapterVersion },
        overrides: {},
      }
    : packRuntimeWorkspace(workspaceRoot, artifacts);
const consumerEnv = standaloneConsumerEnv();
const lanes = {
  minimum: {
    "@langchain/core": "1.2.10",
    "@langchain/langgraph": "1.4.14",
    langchain: "1.5.11",
    zod: "3.25.76",
  },
  latest: manifest(packageRoot).peerDependencies,
};

const smoke = `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('@copilotkit/intelligence-delivery-core'), e => e.code === 'MODULE_NOT_FOUND');
const load = process.argv[2] === 'require' ? async s => require(s) : s => import(s);
const { createSkillRegistryMiddleware, SkillRegistry, SkillDeliveryError } = await load('@copilotkit/intelligence-langgraph');
const { CopilotKitIntelligence } = await load('@copilotkit/runtime/v2');
const { createAgent } = await load('langchain');
const { BaseChatModel } = await load('@langchain/core/language_models/chat_models');
const { AIMessage, ToolMessage } = await load('@langchain/core/messages');
const { zipSync, strToU8 } = await load('fflate');
assert.equal(typeof CopilotKitIntelligence.prototype.getLearnedSkillsSnapshot, 'function');
let revision = 'A', fetches = 0;
function archive() {
 const text = \`private skill \${revision}\`;
 const manifest = {schemaVersion:1, revision, skills:[{name:'refund',description:\`Refund \${revision}\`,files:[{path:'SKILL.md',size:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}]}]};
 const bytes=zipSync({'manifest.json':strToU8(JSON.stringify(manifest)), 'refund/SKILL.md':strToU8(text)});
 return {status:'snapshot',bytes,revision,etag:\`"\${createHash('sha256').update(bytes).digest('hex')}"\`,contentType:'application/zip'};
}
const client=new CopilotKitIntelligence({apiKey:'local-test'});
client.getLearnedSkillsSnapshot=async()=>{fetches++;return archive()};
const registry=new SkillRegistry({client,containerId:'local-container',freshnessWindowMs:0});
const catalogs=[];
class Model extends BaseChatModel {
 _llmType(){return 'packaged-local-test'}
 bindTools(tools){assert.equal(tools.length,2);return this}
 async _generate(messages){
  catalogs.push(messages[0].text);
  if(!messages.some(m=>ToolMessage.isInstance(m))){revision='B';await registry.acquireSnapshot();return {generations:[{text:'',message:new AIMessage({content:'',tool_calls:[{id:'load',name:'copilotkit_load_skill',args:{skill_name:'refund'}},{id:'read',name:'copilotkit_read_skill_file',args:{skill_name:'refund',path:'SKILL.md'}}]})}]}}
  return {generations:[{text:'done',message:new AIMessage('done')}]};
 }
}
const skills=createSkillRegistryMiddleware({registry});
const agent=skills.wrapAgent(createAgent({model:new Model({}),systemPrompt:'Keep developer instructions.',middleware:[skills]})).withConfig({tags:['compatibility']});
const result=await agent.invoke({messages:[{role:'user',content:'refund'}]});
assert.equal(result.messages.at(-1).text,'done');
assert.equal(result.messages.filter(m=>ToolMessage.isInstance(m)).length,2);
for(const output of result.messages.filter(m=>ToolMessage.isInstance(m)))assert.match(output.text,/private skill A/);
for(const catalog of catalogs){assert.match(catalog,/Keep developer instructions/);assert.match(catalog,/Refund A/);assert.doesNotMatch(catalog,/Refund B/)}
assert.equal(fetches,2);
const stream = await agent.stream({messages:[{role:'user',content:'stream refund'}]});
const reader = stream.getReader();
let chunks = 0;
while (true) { const next = await reader.read(); if (next.done) break; chunks++; }
assert.ok(chunks > 0);
client.getLearnedSkillsSnapshot = async () => { throw new SkillDeliveryError('REVISION_REVOKED', false); };
await assert.rejects(agent.invoke({messages:[{role:'user',content:'denied'}]}), e => e instanceof SkillDeliveryError && e.code === 'REVISION_REVOKED');
console.log(JSON.stringify({mode:process.argv[2],result:'PASS',tools:2,fetches,catalogs:catalogs.length,streamChunks:chunks,typedDenial:true}));
`;
const types = `import { createSkillRegistryMiddleware, SkillRegistry } from '@copilotkit/intelligence-langgraph';
import { CopilotKitIntelligence } from '@copilotkit/runtime/v2';
import { createAgent } from 'langchain';
import { z } from 'zod/v4';
const registry = new SkillRegistry({client:new CopilotKitIntelligence({apiKey:'local'}),containerId:'container'});
const skills = createSkillRegistryMiddleware({registry});
const native = createAgent({model:'openai:gpt-4.1-mini',middleware:[skills],responseFormat:z.object({answer:z.string(),count:z.number()})});
const agent = skills.wrapAgent(native);
const same: typeof native = agent;
const configured = agent.withConfig({tags:['typecheck']});
async function inference() {
 const result = await configured.invoke({messages:[{role:'user',content:'test'}]});
 const answer: string = result.structuredResponse.answer;
 const count: number = result.structuredResponse.count;
 // @ts-expect-error Preserve structured response shape.
 const missing = result.structuredResponse.notAField;
 return {answer,count,missing};
}
void same; void inference;
`;

for (const [lane, peers] of Object.entries(
  monitor
    ? {
        zod3: { zod: "3.25.76", ...monitor.dependencies },
        zod4: { zod: "4.6.1", ...monitor.dependencies },
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
        dependencies: {
          ...peers,
          "@copilotkit/intelligence-langgraph":
            monitor?.track === "published" ? adapter : `file:${adapter}`,
          ...runtime.dependencies,
          typescript: "5.8.2",
          "@types/node": "22.15.3",
          fflate: "0.8.2",
          // Runtime channels-core exposes an optional Vitest 4 testing peer.
          vitest: "4.1.11",
        },
        overrides: runtime.overrides,
      },
      null,
      2,
    ),
  );
  // npm 10 Arborist crashes on Runtime's optional peer graph; pin test tooling.
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
  for (const folder of ["src", "conformance"])
    cpSync(join(packageRoot, folder), join(cwd, folder), { recursive: true });
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
    ["node_modules/vitest/vitest.mjs", "run"],
  ]) {
    execFileSync(process.execPath, args, {
      cwd,
      stdio: "inherit",
      env: { ...consumerEnv, COPILOTKIT_TELEMETRY_DISABLED: "true" },
    });
  }
  console.log(
    `${lane}: installed distribution, ESM/CJS inference, and native suites passed`,
  );
}
