import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { standaloneConsumerEnv } from "../../tools/learned-skill-conformance/workspace-artifacts.mjs";

export function validateDepName(dep) {
  if (!/^[@\w][\w./-]*(?:@[\w.^~>=<*-]+)?$/.test(dep)) {
    throw new Error(`Invalid dependency name: ${dep}`);
  }
  return dep;
}

/** Share successful npm installs, using checkout artifacts for Runtime snippets. */
export function createDependencyInstaller({
  outputDir,
  packRuntime,
  runtimeAgentDependencies = {},
  install = execFileSync,
}) {
  let artifacts;
  return function installDependencies(snippetDir, deps) {
    // Validate user-authored sidecars before introducing trusted artifact paths.
    const safe = deps.map(validateDepName);
    const dependencies = Object.fromEntries(
      safe.map((dep) => {
        const separator = dep.lastIndexOf("@");
        return separator > 0
          ? [dep.slice(0, separator), dep.slice(separator + 1)]
          : [dep, "*"];
      }),
    );
    let overrides = {};
    const hash = createHash("sha256");
    if (Object.hasOwn(dependencies, "@copilotkit/runtime")) {
      artifacts ??= packRuntime();
      Object.assign(dependencies, artifacts.dependencies);
      overrides = { ...artifacts.overrides };
      // Runtime and framework agents must share one AbstractAgent class identity.
      // Keep other framework dependencies and their peer checks unchanged.
      for (const name of ["@ag-ui/client", "@ag-ui/core"]) {
        const version = runtimeAgentDependencies[name];
        if (version) {
          dependencies[name] = version;
          overrides[name] = `$${name}`;
        }
      }
      // Paths alone do not identify a rebuild of the same package version.
      for (const [name, spec] of Object.entries(
        artifacts.dependencies,
      ).sort()) {
        hash.update(name).update(readFileSync(spec.slice("file:".length)));
      }
    }
    hash.update(
      JSON.stringify({
        dependencies: Object.entries(dependencies).sort(),
        overrides: Object.entries(overrides).sort(),
      }),
    );
    const store = join(outputDir, ".deps", hash.digest("hex").slice(0, 16));
    const storeModules = join(store, "node_modules");
    const complete = join(store, ".installed");
    if (!existsSync(complete) || !existsSync(storeModules)) {
      mkdirSync(store, { recursive: true });
      writeFileSync(
        join(store, "package.json"),
        JSON.stringify(
          {
            name: "doctest-deps",
            version: "1.0.0",
            private: true,
            dependencies,
            overrides,
          },
          null,
          2,
        ),
      );
      install("npm", ["install", "--no-audit", "--no-fund"], {
        cwd: store,
        env: standaloneConsumerEnv(),
        stdio: "pipe",
        timeout: 300_000,
      });
      writeFileSync(complete, "installed\n");
    }
    // The snippet output is generated; replace links from earlier source builds.
    const link = join(snippetDir, "node_modules");
    rmSync(link, { recursive: true, force: true });
    symlinkSync(storeModules, link, "junction");
  };
}
