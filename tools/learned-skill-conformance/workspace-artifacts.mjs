import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** Pack the checkout's public Runtime dependency graph for standalone consumers. */
export function packRuntimeWorkspace(workspaceRoot, artifactsDirectory, env) {
  const packages = new Map();
  const packagesDirectory = join(workspaceRoot, "packages");
  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = join(packagesDirectory, entry.name);
    const manifestFile = join(root, "package.json");
    if (!existsSync(manifestFile)) continue;
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    packages.set(manifest.name, { root, manifest });
  }

  const selected = new Map();
  function visit(name) {
    if (selected.has(name)) return;
    const entry = packages.get(name);
    if (!entry) throw new Error(`Missing Runtime workspace package: ${name}`);
    if (entry.manifest.private) {
      throw new Error(`Cannot install private Runtime dependency: ${name}`);
    }
    selected.set(name, entry);
    const dependencies = {
      ...entry.manifest.dependencies,
      ...entry.manifest.optionalDependencies,
    };
    for (const dependency of Object.keys(dependencies)) {
      if (packages.has(dependency)) visit(dependency);
    }
  }
  // Validate the whole graph before producing artifacts. Development dependencies
  // (including the private delivery core) are never consumer dependencies.
  visit("@copilotkit/runtime");

  const artifacts = resolve(artifactsDirectory);
  mkdirSync(artifacts, { recursive: true });
  const dependencies = {};
  const overrides = {};
  for (const [name, { root, manifest }] of selected) {
    execFileSync("pnpm", ["pack", "--pack-destination", artifacts], {
      cwd: root,
      stdio: "pipe",
      ...(env ? { env } : {}),
    });
    const archive = `${name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
    dependencies[name] = `file:${join(artifacts, archive)}`;
    // npm's direct-dependency reference also replaces nested workspace packages.
    // External framework peers retain their declared compatibility constraints.
    overrides[name] = `$${name}`;
  }
  return { dependencies, overrides };
}

/** Prevent workspace module paths injected by Nx/pnpm from leaking into consumers. */
export function standaloneConsumerEnv(environment = process.env) {
  const consumerEnv = { ...environment };
  delete consumerEnv.NODE_PATH;
  return consumerEnv;
}
