import { satisfies } from "semver";

export interface PackedManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
}

interface ConsumerManifestOptions {
  umbrellaTarball: string;
  packageManager: string;
  typescript: string;
  nodeTypes: string;
  overrides?: ReadonlyMap<string, string>;
}

export const FOUNDATION = [
  "@copilotkit/channels-core",
  "@copilotkit/channels-ui",
] as const;

export const ADAPTERS = [
  "@copilotkit/channels-slack",
  "@copilotkit/channels-teams",
  "@copilotkit/channels-intelligence",
  "@copilotkit/channels-discord",
  "@copilotkit/channels-telegram",
  "@copilotkit/channels-whatsapp",
] as const;

export const FAMILY = [
  ...FOUNDATION,
  ...ADAPTERS,
  "@copilotkit/channels",
] as const;

export function createConsumerWorkspaceYaml(): string {
  return [
    "minimumReleaseAgeExclude:",
    ...[...FAMILY, "@copilotkit/core", "@copilotkit/shared"].map(
      (name) => `  - ${JSON.stringify(name)}`,
    ),
    "",
  ].join("\n");
}

export function createConsumerManifest({
  umbrellaTarball,
  packageManager,
  typescript,
  nodeTypes,
  overrides,
}: ConsumerManifestOptions): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    name: "channels-umbrella-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    packageManager,
    dependencies: {
      "@copilotkit/channels": `file:${umbrellaTarball}`,
    },
    devDependencies: {
      "@types/node": nodeTypes,
      typescript,
    },
  };

  if (overrides?.size) {
    manifest.pnpm = {
      overrides: Object.fromEntries(
        [...overrides].map(([name, tarball]) => [name, `file:${tarball}`]),
      ),
    };
  }

  return manifest;
}

function requireManifest(
  manifests: ReadonlyMap<string, PackedManifest>,
  name: string,
  problems: string[],
): PackedManifest | undefined {
  const manifest = manifests.get(name);
  if (!manifest) problems.push(`missing packed manifest for ${name}`);
  return manifest;
}

function requireCompatibleRange(
  owner: PackedManifest,
  dependency: PackedManifest,
  problems: string[],
): void {
  const range = owner.dependencies?.[dependency.name];
  if (!range) {
    problems.push(`${owner.name} is missing ${dependency.name}`);
    return;
  }

  try {
    if (!satisfies(dependency.version, range)) {
      problems.push(
        `${owner.name} declares ${dependency.name}@${range}, which does not accept ${dependency.version}`,
      );
    }
  } catch {
    problems.push(
      `${owner.name} declares an invalid ${dependency.name} range: ${range}`,
    );
  }
}

export function validatePackedManifests(
  manifests: ReadonlyMap<string, PackedManifest>,
): string[] {
  const problems: string[] = [];
  const umbrella = requireManifest(manifests, "@copilotkit/channels", problems);
  const core = requireManifest(
    manifests,
    "@copilotkit/channels-core",
    problems,
  );
  const ui = requireManifest(manifests, "@copilotkit/channels-ui", problems);
  if (!umbrella || !core || !ui) return problems;

  const expectedUmbrellaDependencies = [...FOUNDATION, ...ADAPTERS];
  const expectedNames = new Set<string>(expectedUmbrellaDependencies);
  for (const name of expectedUmbrellaDependencies) {
    const dependency = requireManifest(manifests, name, problems);
    if (!dependency) continue;

    const pinned = umbrella.dependencies?.[name];
    if (pinned !== dependency.version) {
      problems.push(
        `${umbrella.name} must pack ${name} exactly as ${dependency.version}; found ${pinned ?? "missing"}`,
      );
    }
  }
  for (const name of Object.keys(umbrella.dependencies ?? {})) {
    if (!expectedNames.has(name)) {
      problems.push(`${umbrella.name} has unexpected dependency ${name}`);
    }
  }

  requireCompatibleRange(core, ui, problems);
  for (const foundation of [core, ui]) {
    if (foundation.dependencies?.[umbrella.name]) {
      problems.push(`${foundation.name} must not depend on ${umbrella.name}`);
    }
  }
  if (ui.dependencies?.[core.name]) {
    problems.push(`${ui.name} must not depend on ${core.name}`);
  }

  for (const name of ADAPTERS) {
    const adapter = requireManifest(manifests, name, problems);
    if (!adapter) continue;
    if (adapter.dependencies?.[umbrella.name]) {
      problems.push(`${adapter.name} must not depend on ${umbrella.name}`);
    }
    requireCompatibleRange(adapter, core, problems);
    requireCompatibleRange(adapter, ui, problems);
  }

  return problems;
}
