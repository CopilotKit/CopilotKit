import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const ADAPTER_PACKAGES = [
  {
    id: "copilotkit-intelligence-adk",
    registry: "pypi",
    directory: "sdk-python-adk",
    manifest: "sdk-python-adk/pyproject.toml",
    tagPrefix: "intelligence-adk-python/v",
  },
  {
    id: "copilotkit-intelligence-langgraph",
    registry: "pypi",
    directory: "sdk-python-langgraph",
    manifest: "sdk-python-langgraph/pyproject.toml",
    tagPrefix: "intelligence-langgraph-python/v",
  },
  {
    id: "@copilotkit/intelligence-langgraph",
    registry: "npm",
    directory: "packages/intelligence-langgraph",
    manifest: "packages/intelligence-langgraph/package.json",
    tagPrefix: "intelligence-langgraph/v",
  },
  {
    id: "copilotkit-intelligence-agent-framework",
    registry: "pypi",
    directory: "sdk-python-agent-framework",
    manifest: "sdk-python-agent-framework/pyproject.toml",
    tagPrefix: "intelligence-agent-framework-python/v",
  },
  {
    id: "CopilotKit.Intelligence.AgentFramework",
    registry: "nuget",
    directory: "sdk-dotnet-agent-framework",
    manifest:
      "sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework/CopilotKit.Intelligence.AgentFramework.csproj",
    tagPrefix: "intelligence-agent-framework-dotnet/v",
  },
] as const;

export type AdapterPackageId = (typeof ADAPTER_PACKAGES)[number]["id"];
type Registry = (typeof ADAPTER_PACKAGES)[number]["registry"];
type AdapterPackage = (typeof ADAPTER_PACKAGES)[number];

export interface DetectorResult {
  shouldPublish: boolean;
  name: AdapterPackageId;
  version: string;
  directory: string;
  tagPrefix: string;
  concurrencyKey: string;
}

export interface DetectorOptions {
  root?: string;
  registryFixturePath?: string;
  fetchImpl?: typeof fetch;
}

interface FixtureEntry {
  status: number;
  body?: unknown;
}

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function getPackage(packageId: AdapterPackageId): AdapterPackage {
  const packageConfig = ADAPTER_PACKAGES.find(({ id }) => id === packageId);
  if (!packageConfig) {
    throw new Error(`Unknown Intelligence adapter package: ${packageId}`);
  }
  return packageConfig;
}

function stableSemver(version: string, context: string): string {
  if (!STABLE_SEMVER.test(version)) {
    throw new Error(
      `${context} must be a stable SemVer, got ${JSON.stringify(version)}`,
    );
  }
  return version;
}

function compareStableSemver(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function requireSingleMatch(
  contents: string,
  pattern: RegExp,
  label: string,
  manifest: string,
): string {
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1 || !matches[0][1]) {
    throw new Error(
      `Malformed manifest ${manifest}: expected exactly one ${label}`,
    );
  }
  return matches[0][1];
}

function readPythonManifest(
  manifestPath: string,
  manifest: string,
): { name: string; version: string } {
  const contents = fs.readFileSync(manifestPath, "utf8");
  const lines = contents.split(/\r?\n/);
  const sectionStart = lines.findIndex(
    (line) => line.trim() === "[tool.poetry]",
  );
  if (sectionStart === -1) {
    throw new Error(`Malformed manifest ${manifest}: missing [tool.poetry]`);
  }
  const nextSectionOffset = lines
    .slice(sectionStart + 1)
    .findIndex((line) => /^\s*\[.+\]\s*$/.test(line));
  const sectionEnd =
    nextSectionOffset === -1
      ? lines.length
      : sectionStart + 1 + nextSectionOffset;
  const section = lines.slice(sectionStart + 1, sectionEnd).join("\n");
  return {
    name: requireSingleMatch(
      section,
      /^name\s*=\s*"([^"]+)"\s*$/gm,
      "tool.poetry name",
      manifest,
    ),
    version: requireSingleMatch(
      section,
      /^version\s*=\s*"([^"]+)"\s*$/gm,
      "tool.poetry version",
      manifest,
    ),
  };
}

function readNpmManifest(
  manifestPath: string,
  manifest: string,
): { name: string; version: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Malformed manifest ${manifest}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { name?: unknown }).name !== "string" ||
    typeof (parsed as { version?: unknown }).version !== "string"
  ) {
    throw new Error(
      `Malformed manifest ${manifest}: name/version must be strings`,
    );
  }
  return parsed as { name: string; version: string };
}

function readNugetManifest(
  manifestPath: string,
  manifest: string,
): { name: string; version: string } {
  const contents = fs.readFileSync(manifestPath, "utf8");
  return {
    name: requireSingleMatch(
      contents,
      /<PackageId>\s*([^<]+?)\s*<\/PackageId>/g,
      "PackageId",
      manifest,
    ),
    version: requireSingleMatch(
      contents,
      /<Version>\s*([^<]+?)\s*<\/Version>/g,
      "Version",
      manifest,
    ),
  };
}

function readManifest(
  packageConfig: AdapterPackage,
  root: string,
): { name: string; version: string } {
  const manifestPath = path.join(root, packageConfig.manifest);
  try {
    if (packageConfig.registry === "pypi") {
      return readPythonManifest(manifestPath, packageConfig.manifest);
    }
    if (packageConfig.registry === "npm") {
      return readNpmManifest(manifestPath, packageConfig.manifest);
    }
    return readNugetManifest(manifestPath, packageConfig.manifest);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Malformed manifest")
    ) {
      throw error;
    }
    throw new Error(
      `Malformed manifest ${packageConfig.manifest}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function registryUrl(registry: Registry, packageId: AdapterPackageId): string {
  if (registry === "pypi") {
    return `https://pypi.org/pypi/${packageId}/json`;
  }
  if (registry === "npm") {
    return `https://registry.npmjs.org/${encodeURIComponent(packageId)}`;
  }
  return `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/index.json`;
}

function readFixtureEntry(
  fixturePath: string,
  packageId: AdapterPackageId,
): FixtureEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Malformed registry fixture ${fixturePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entry = (
    parsed as { packages?: Record<string, FixtureEntry | undefined> }
  )?.packages?.[packageId];
  if (!entry || !Number.isInteger(entry.status)) {
    throw new Error(
      `Malformed registry fixture ${fixturePath}: missing integer status for ${packageId}`,
    );
  }
  return entry;
}

async function registryResponse(
  packageConfig: AdapterPackage,
  options: DetectorOptions,
): Promise<FixtureEntry> {
  if (options.registryFixturePath) {
    const fixturePath = path.isAbsolute(options.registryFixturePath)
      ? options.registryFixturePath
      : path.join(ROOT, options.registryFixturePath);
    return readFixtureEntry(fixturePath, packageConfig.id);
  }

  const url = registryUrl(packageConfig.registry, packageConfig.id);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch (error) {
    throw new Error(
      `Registry transport failure for ${packageConfig.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (response.status !== 404) {
      throw new Error(
        `Malformed ${packageConfig.registry} registry response for ${packageConfig.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { status: response.status, body };
}

function publishedVersions(
  packageConfig: AdapterPackage,
  body: unknown,
): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(
      `Malformed ${packageConfig.registry} registry response for ${packageConfig.id}`,
    );
  }
  if (packageConfig.registry === "pypi") {
    const response = body as {
      info?: { name?: unknown };
      releases?: unknown;
    };
    if (
      !response.info ||
      response.info.name !== packageConfig.id ||
      !response.releases ||
      typeof response.releases !== "object" ||
      Array.isArray(response.releases)
    ) {
      throw new Error(
        `Malformed PyPI registry response for ${packageConfig.id}`,
      );
    }
    return Object.keys(response.releases);
  }
  if (packageConfig.registry === "npm") {
    const response = body as { name?: unknown; versions?: unknown };
    if (
      response.name !== packageConfig.id ||
      !response.versions ||
      typeof response.versions !== "object" ||
      Array.isArray(response.versions)
    ) {
      throw new Error(
        `Malformed npm registry response for ${packageConfig.id}`,
      );
    }
    return Object.keys(response.versions);
  }
  const versions = (body as { versions?: unknown }).versions;
  if (
    !Array.isArray(versions) ||
    !versions.every((value) => typeof value === "string")
  ) {
    throw new Error(
      `Malformed NuGet registry response for ${packageConfig.id}`,
    );
  }
  return versions;
}

export async function detectAdapterVersion(
  packageId: AdapterPackageId,
  options: DetectorOptions = {},
): Promise<DetectorResult> {
  const packageConfig = getPackage(packageId);
  const manifest = readManifest(packageConfig, options.root ?? ROOT);
  if (manifest.name !== packageConfig.id) {
    throw new Error(
      `Manifest identity mismatch for ${packageConfig.manifest}: expected ${packageConfig.id}, got ${manifest.name}`,
    );
  }
  const version = stableSemver(
    manifest.version,
    `Manifest version for ${packageConfig.id}`,
  );
  const registry = await registryResponse(packageConfig, options);
  let shouldPublish: boolean;
  if (registry.status === 404) {
    shouldPublish = true;
  } else if (registry.status !== 200) {
    throw new Error(
      `Registry HTTP ${registry.status} for ${packageConfig.id}; only 200 and 404 are valid detector responses`,
    );
  } else {
    const stableVersions = publishedVersions(
      packageConfig,
      registry.body,
    ).filter((published) => STABLE_SEMVER.test(published));
    const newer = stableVersions
      .filter((published) => compareStableSemver(published, version) > 0)
      .sort(compareStableSemver)[0];
    if (newer) {
      throw new Error(
        `Registry contains newer stable version ${newer} for ${packageConfig.id}; local manifest is ${version}`,
      );
    }
    shouldPublish = !stableVersions.includes(version);
  }

  return {
    shouldPublish,
    name: packageConfig.id,
    version,
    directory: packageConfig.directory,
    tagPrefix: packageConfig.tagPrefix,
    concurrencyKey: `${packageConfig.id}@${version}`,
  };
}

export function formatDetectorOutputs(result: DetectorResult): string {
  return (
    `should_publish=${result.shouldPublish}\n` +
    `name=${result.name}\n` +
    `version=${result.version}\n` +
    `directory=${result.directory}\n` +
    `tag_prefix=${result.tagPrefix}\n`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const packageIndex = args.indexOf("--package");
  const fixtureIndex = args.indexOf("--registry-fixture");
  const allowed = new Set(["--package", "--registry-fixture", "--dry-run"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      !allowed.has(argument) &&
      args[index - 1] !== "--package" &&
      args[index - 1] !== "--registry-fixture"
    ) {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (packageIndex === -1 || !args[packageIndex + 1]) {
    throw new Error(
      "Usage: detect-intelligence-adapter-version-changes.ts --package <package-id> [--registry-fixture <path>] [--dry-run]",
    );
  }
  if (
    args[packageIndex + 1].startsWith("--") ||
    (fixtureIndex !== -1 &&
      (!args[fixtureIndex + 1] || args[fixtureIndex + 1].startsWith("--")))
  ) {
    throw new Error(
      "Both --package and, when present, --registry-fixture require a value",
    );
  }
  const result = await detectAdapterVersion(
    args[packageIndex + 1] as AdapterPackageId,
    {
      registryFixturePath:
        fixtureIndex === -1 ? undefined : args[fixtureIndex + 1],
    },
  );
  const output = formatDetectorOutputs(result);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
  }
  process.stdout.write(output);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
