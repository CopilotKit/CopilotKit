import assert from "node:assert/strict";
import { readFileSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { validateRequest, adapters } from "./request.mjs";
/** Use the selected published adapter's dependency, not its own version. */
export function publishedRuntime(plan, env, command = execFileSync) {
  const dependencies = JSON.parse(
    command(
      "npm",
      [
        "view",
        `${adapters[plan.adapterId].name}@${plan.adapterVersion}`,
        "dependencies",
        "--json",
      ],
      { env, encoding: "utf8", timeout: 60_000 },
    ),
  );
  const runtime = dependencies?.["@copilotkit/runtime"];
  assert.ok(
    typeof runtime === "string" && runtime.trim(),
    "Published adapter is missing its runtime dependency",
  );
  return { dependencies: { "@copilotkit/runtime": runtime }, overrides: {} };
}

export function monitorPlan(argv = process.argv) {
  const i = argv.indexOf("--monitor-plan");
  if (i < 0) return undefined;
  const { output: _output, ...request } = JSON.parse(
    readFileSync(argv[i + 1], "utf8"),
  );
  return validateRequest(request);
}
export function monitorOutput(argv = process.argv) {
  const i = argv.indexOf("--monitor-plan");
  return i < 0
    ? undefined
    : JSON.parse(readFileSync(argv[i + 1], "utf8")).output;
}
export function prepareMonitorConsumer(plan, cwd) {
  if (!plan) return;
  // Only public-boundary native tests execute. Internal source unit suites remain
  // covered by ordinary adapter CI; they cannot establish published compatibility.
  const test =
    plan.adapterId === "langgraph-ts"
      ? "middleware.test.ts"
      : "processor.test.ts";
  const path = join(cwd, "src/__tests__", test);
  let text = readFileSync(path, "utf8").replaceAll(
    '"../index.js"',
    JSON.stringify(adapters[plan.adapterId].name),
  );
  if (plan.adapterId === "langgraph-ts")
    text = text.replace(
      'import { SkillRegistry } from "@copilotkit/intelligence-delivery-core";',
      `import { SkillRegistry } from ${JSON.stringify(adapters[plan.adapterId].name)};`,
    );
  writeFileSync(path, text);
  writeFileSync(
    join(cwd, "vitest.config.mts"),
    `import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['src/__tests__/${test}'],maxWorkers:2,env:{COPILOTKIT_TELEMETRY_DISABLED:'true'}}});`,
  );
}
export function installMonitorConsumer(plan, cwd, env, output) {
  const args = [
    "exec",
    "--yes",
    "--package=npm@11.6.2",
    "--",
    "npm",
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ];
  try {
    execFileSync("npm", args, { cwd, env, stdio: "inherit" });
  } catch (error) {
    if (!plan?.experimental) throw error;
    writeFileSync(
      join(output, "declared-install-rejected.txt"),
      "Normal npm install rejected the dependency graph; experimental overrides follow.",
    );
    execFileSync("npm", [...args, "--legacy-peer-deps"], {
      cwd,
      env,
      stdio: "inherit",
    });
  }
  if (!plan) return;
  const zod = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))
    .dependencies.zod;
  cpSync(
    join(cwd, "package-lock.json"),
    join(output, `consumer-zod-${zod}-package-lock.json`),
  );
  writeFileSync(join(cwd, "versions.mjs"), versionProbe(plan));
  const evidence = execFileSync(process.execPath, ["versions.mjs"], {
    cwd,
    env,
    encoding: "utf8",
  });
  const target = join(output, "consumer-evidence.json");
  const previous = existsSync(target)
    ? JSON.parse(readFileSync(target, "utf8"))
    : {};
  const lock = JSON.parse(readFileSync(join(cwd, "package-lock.json"), "utf8"));
  const graph = Object.fromEntries(
    Object.entries(lock.packages)
      .filter(([key, value]) => key && value.version)
      .map(([key, value]) => [key, value.version]),
  );
  writeFileSync(
    target,
    JSON.stringify({
      ...JSON.parse(evidence),
      resolvedGraph: { ...previous.resolvedGraph, ...graph },
    }),
  );
}

/** Entry each watched package is imported through. ESM-only packages are absent: they are found on disk instead, because `require.resolve` cannot see them. */
const ENTRYPOINTS = {
  "@langchain/core": "@langchain/core/messages",
  "@langchain/langgraph": "@langchain/langgraph",
  langchain: "langchain",
  "@mastra/core": "@mastra/core/agent",
  zod: "zod",
  ai: "ai",
};

/**
 * Script text (ES module) that imports each dependency of `plan` from the
 * consumer and from the installed adapter, and prints the versions it loaded.
 * Resolving from both contexts detects nested duplicate framework installs.
 * Fails when a loaded version differs from the requested one.
 */
export function versionProbe(plan) {
  const adapter = adapters[plan.adapterId];
  return `import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
const root=createRequire(import.meta.url);
const contexts=[root,createRequire(root.resolve(${JSON.stringify(adapter.entrypoint ?? adapter.name)}))];
const expected=${JSON.stringify(plan.dependencies)};
const entries=${JSON.stringify(ENTRYPOINTS)};
const readPackage=(dir)=>JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
function locate(require,name){
  if(entries[name]){
    const entry=require.resolve(entries[name]);
    let dir=dirname(entry);
    while(!existsSync(join(dir,'package.json'))||readPackage(dir).name!==name){const parent=dirname(dir);if(parent===dir)throw Error('Package metadata absent');dir=parent;}
    return {entry,dir};
  }
  // ESM-only: walk the same node_modules chain require would, and import the package's "." import target.
  for(const base of require.resolve.paths(name)??[]){
    const dir=join(base,name);
    if(!existsSync(join(dir,'package.json')))continue;
    const pkg=readPackage(dir);const main=pkg.exports?.['.'];
    const target=typeof main==='string'?main:main?.import??main?.default??pkg.module??pkg.main;
    if(!target)throw Error('No import entry for '+name);
    return {entry:join(dir,target),dir};
  }
  throw Error('Cannot locate '+name);
}
const result={};
for(const [name,version] of Object.entries(expected)){
  for(const require of contexts){
    const {entry,dir}=locate(require,name);
    await import(entry);
    const actual=readPackage(dir).version;
    if(actual!==version)throw Error('Loaded version mismatch: '+name+' '+actual);
    result[name]=actual;
  }
}
console.log(JSON.stringify({resolvedDependencies:result}));
`;
}

export function verifyNativeReport(report) {
  assert.ok(report.numTotalTests > 0, "No native tests executed");
  assert.equal(report.numPendingTests, 0, "Native tests were skipped");
  assert.equal(
    report.numPassedTests,
    report.numTotalTests,
    "Native tests did not all pass",
  );
}
