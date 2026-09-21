import assert from "node:assert/strict";
import { readFileSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { validateRequest, adapters } from "./request.mjs";
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
  // Resolve from both consumer and installed adapter contexts to detect nested
  // duplicate framework installs. Import each entry before recording its version.
  const entrypoints = {
    "@langchain/core": "@langchain/core/messages",
    "@langchain/langgraph": "@langchain/langgraph",
    langchain: "langchain",
    "@mastra/core": "@mastra/core/agent",
    zod: "zod",
    ai: "ai",
  };
  const code = `import {createRequire} from 'node:module';import {readFileSync,existsSync} from 'node:fs';import {dirname,join} from 'node:path';const root=createRequire(import.meta.url);const contexts=[root,createRequire(root.resolve(${JSON.stringify(adapters[plan.adapterId].entrypoint ?? adapters[plan.adapterId].name)}))];const expected=${JSON.stringify(plan.dependencies)};const entries=${JSON.stringify(entrypoints)};let result={};for(const [name,version] of Object.entries(expected)){for(const require of contexts){const entry=require.resolve(entries[name]);await import(entry);let dir=dirname(entry);while(!existsSync(join(dir,'package.json'))||JSON.parse(readFileSync(join(dir,'package.json'))).name!==name){const parent=dirname(dir);if(parent===dir)throw Error('Package metadata absent');dir=parent;}const actual=JSON.parse(readFileSync(join(dir,'package.json'))).version;if(actual!==version)throw Error('Loaded version mismatch: '+name+' '+actual);result[name]=actual;}}console.log(JSON.stringify({resolvedDependencies:result}));`;
  writeFileSync(join(cwd, "versions.mjs"), code);
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

export function verifyNativeReport(report) {
  assert.ok(report.numTotalTests > 0, "No native tests executed");
  assert.equal(report.numPendingTests, 0, "Native tests were skipped");
  assert.equal(
    report.numPassedTests,
    report.numTotalTests,
    "Native tests did not all pass",
  );
}
