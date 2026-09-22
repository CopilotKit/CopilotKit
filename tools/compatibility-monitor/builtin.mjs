import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { packRuntimeWorkspace } from "../learned-skill-conformance/workspace-artifacts.mjs";
import { verifyResolved } from "./request.mjs";
import { installMonitorConsumer, verifyNativeReport } from "./typescript.mjs";

/** Copy the native contracts, replacing only their workspace import boundaries. */
export function prepareBuiltinConsumer(source, work) {
  const tests = join(source, "packages/runtime/src/agent/__tests__");
  const native = readFileSync(
    join(tests, "learned-skills-native.test.ts"),
    "utf8",
  )
    .replace('from "../index"', 'from "@copilotkit/runtime/v2"')
    .replace(
      '"../../../../intelligence-delivery-core/conformance/snapshots.v1.json"',
      '"./snapshots.v1.json"',
    );
  writeFileSync(join(work, "learned-skills-native.test.ts"), native);
  const types = readFileSync(
    join(tests, "learned-skills-types.test.ts"),
    "utf8",
  )
    .replace('from "../../v2"', 'from "@copilotkit/runtime/v2"')
    .replace('from "../learned-skills"', 'from "@copilotkit/runtime/v2"');
  writeFileSync(join(work, "learned-skills-types.test.ts"), types);
  cpSync(join(tests, "test-helpers.ts"), join(work, "test-helpers.ts"));
  // Only these two pure helpers are used by the native suite. Runtime execution
  // remains in the installed package and the actual AI SDK streamText pipeline.
  writeFileSync(
    join(work, "agent-test-helpers.ts"),
    `import type { RunAgentInput } from '@ag-ui/client';
export { collectEvents } from './test-helpers';
export function createDefaultInput(overrides?: Partial<RunAgentInput>): RunAgentInput {
  return {threadId:'test-thread',runId:'test-run',messages:[],tools:[],context:[],state:{},forwardedProps:{},...overrides};
}
`,
  );
  cpSync(
    join(
      source,
      "packages/intelligence-delivery-core/conformance/snapshots.v1.json",
    ),
    join(work, "snapshots.v1.json"),
  );
  writeFileSync(
    join(work, "vitest.config.mts"),
    `import {defineConfig} from 'vitest/config'; export default defineConfig({test:{include:['learned-skills-native.test.ts','learned-skills-types.test.ts'],maxWorkers:2,env:{COPILOTKIT_TELEMETRY_DISABLED:'true'}}});`,
  );
  writeFileSync(
    join(work, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
      include: [
        "learned-skills-native.test.ts",
        "learned-skills-types.test.ts",
      ],
    }),
  );
}

export async function runBuiltin(
  r,
  { source, output, work, command, state, runCase, env },
) {
  if (r.track === "source")
    command(
      "pnpm",
      ["nx", "run", "@copilotkit/runtime:build", "--skip-nx-cache"],
      source,
    );
  const runtime =
    r.track === "source"
      ? packRuntimeWorkspace(source, join(work, "artifacts"), env)
      : {
          dependencies: { "@copilotkit/runtime": r.adapterVersion },
          overrides: {},
        };
  const manifest = JSON.parse(
    readFileSync(join(source, "packages/runtime/package.json"), "utf8"),
  );
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          ...runtime.dependencies,
          ...r.dependencies,
          "@ag-ui/client": manifest.dependencies["@ag-ui/client"],
          rxjs: manifest.dependencies.rxjs,
        },
        overrides: runtime.overrides,
        devDependencies: {
          typescript: "5.8.2",
          "@types/node": "22.15.3",
          vitest: "4.1.11",
        },
      },
      null,
      2,
    ),
  );
  prepareBuiltinConsumer(source, work);
  rmSync(join(output, "consumer-evidence.json"), { force: true });
  rmSync(join(output, "native-results.json"), { force: true });
  installBuiltinConsumer(r, work, env, output);
  const evidence = join(output, "consumer-evidence.json");
  assert.ok(existsSync(evidence), "Consumer did not record loaded versions");
  Object.assign(state, JSON.parse(readFileSync(evidence, "utf8")));
  verifyResolved(r, state.resolvedDependencies);
  runCase("native-types", () =>
    command(
      process.execPath,
      ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
      work,
    ),
  );
  runCase("native-lifecycle", () => {
    command(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "--reporter=json",
        `--outputFile=${join(output, "native-results.json")}`,
      ],
      work,
    );
    const report = JSON.parse(
      readFileSync(join(output, "native-results.json"), "utf8"),
    );
    verifyNativeReport(report);
    // Five lifecycle cases plus the public type-context case must execute.
    assert.ok(
      report.numTotalTests >= 6,
      "Built-in native contracts are missing",
    );
  });
}

/** Preserve declared resolution before forcing an explicitly experimental graph. */
export function installBuiltinConsumer(
  r,
  work,
  env,
  output,
  install = installMonitorConsumer,
) {
  try {
    install({ ...r, experimental: false }, work, env, output);
  } catch (error) {
    if (!r.experimental) throw error;
    writeFileSync(
      join(output, "declared-install-rejected.txt"),
      `Declared install or loaded-version probe rejected the combination: ${error.message}\nExperimental overrides follow.`,
    );
    const path = join(work, "package.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.overrides = {
      ...manifest.overrides,
      ...Object.fromEntries(
        Object.keys(r.dependencies).map((name) => [name, `$${name}`]),
      ),
    };
    writeFileSync(path, JSON.stringify(manifest, null, 2));
    install(r, work, env, output);
  }
}
