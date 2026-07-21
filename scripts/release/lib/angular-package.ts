import { major as semverMajor } from "semver";

export interface AngularSupportEntry {
  angular: string;
  cdk: string;
  major: number;
  typescript: string;
}

export interface AngularSupportContract {
  compilerMajor: number;
  rxjs: string;
  supportedMajors: AngularSupportEntry[];
}

interface AngularConsumerManifestOptions {
  angularTarball: string;
  packageManager: string;
  siblingTarballs: ReadonlyMap<string, string>;
  support: AngularSupportEntry;
  rxjs: string;
}

export interface DependencyNode {
  name?: string;
  version?: string;
  dependencies?: Record<string, DependencyNode>;
  devDependencies?: Record<string, DependencyNode>;
  optionalDependencies?: Record<string, DependencyNode>;
}

const FRAMEWORK_PEERS = [
  "@angular/cdk",
  "@angular/common",
  "@angular/core",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.length) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requireInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value)) throw new Error(`${path} must be an integer`);
  return value as number;
}

function readSupportEntry(value: unknown, index: number): AngularSupportEntry {
  const path = `copilotkit.angularSupport.supportedMajors[${index}]`;
  const entry = requireRecord(value, path);
  return {
    angular: requireString(entry.angular, `${path}.angular`),
    cdk: requireString(entry.cdk, `${path}.cdk`),
    major: requireInteger(entry.major, `${path}.major`),
    typescript: requireString(entry.typescript, `${path}.typescript`),
  };
}

/**
 * Reads the package's single machine-readable Angular compatibility contract.
 */
export function readAngularSupportContract(
  manifest: unknown,
): AngularSupportContract {
  const root = requireRecord(manifest, "package manifest");
  const copilotkit = requireRecord(root.copilotkit, "copilotkit");
  const support = requireRecord(
    copilotkit.angularSupport,
    "copilotkit.angularSupport",
  );
  if (!Array.isArray(support.supportedMajors)) {
    throw new Error(
      "copilotkit.angularSupport.supportedMajors must be an array",
    );
  }

  return {
    compilerMajor: requireInteger(
      support.compilerMajor,
      "copilotkit.angularSupport.compilerMajor",
    ),
    rxjs: requireString(support.rxjs, "copilotkit.angularSupport.rxjs"),
    supportedMajors: support.supportedMajors.map(readSupportEntry),
  };
}

function peerRange(support: AngularSupportContract): string {
  return support.supportedMajors
    .map((entry) => `^${entry.major}.0.0`)
    .join(" || ");
}

function versionMajor(version: string): number | undefined {
  try {
    return semverMajor(version);
  } catch {
    return undefined;
  }
}

/**
 * Validates that published peers, build dependencies, and the CI matrix all
 * express the same Angular compatibility promise.
 */
export function validateAngularPackageManifest(manifest: unknown): string[] {
  let support: AngularSupportContract;
  try {
    support = readAngularSupportContract(manifest);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const root = requireRecord(manifest, "package manifest");
  const peers = isRecord(root.peerDependencies) ? root.peerDependencies : {};
  const dev = isRecord(root.devDependencies) ? root.devDependencies : {};
  const problems: string[] = [];
  if (!support.supportedMajors.length) {
    problems.push("supportedMajors must contain at least one entry");
    return problems;
  }

  for (let index = 0; index < support.supportedMajors.length; index += 1) {
    const entry = support.supportedMajors[index];
    const previous = support.supportedMajors[index - 1];
    if (previous && entry.major <= previous.major) {
      problems.push("supportedMajors must be unique and strictly increasing");
    }
    if (versionMajor(entry.angular) !== entry.major) {
      problems.push(
        `Angular version ${entry.angular} does not match major ${entry.major}`,
      );
    }
    if (versionMajor(entry.cdk) !== entry.major) {
      problems.push(
        `CDK version ${entry.cdk} does not match major ${entry.major}`,
      );
    }
  }

  const floor = support.supportedMajors[0];
  if (support.compilerMajor !== floor.major) {
    problems.push("compilerMajor must equal the lowest supported major");
  }

  const expectedPeerRange = peerRange(support);
  for (const name of FRAMEWORK_PEERS) {
    if (peers[name] !== expectedPeerRange) {
      problems.push(
        `${name} peer range must be ${expectedPeerRange}; found ${String(peers[name] ?? "missing")}`,
      );
    }
  }
  if (peers.rxjs !== support.rxjs) {
    problems.push(
      `rxjs peer range must be ${support.rxjs}; found ${String(peers.rxjs ?? "missing")}`,
    );
  }

  for (const name of [
    "@angular/common",
    "@angular/compiler-cli",
    "@angular/core",
  ]) {
    if (dev[name] !== floor.angular) {
      problems.push(
        `${name} dev dependency must use compiler floor ${floor.angular}; found ${String(dev[name] ?? "missing")}`,
      );
    }
  }
  if (dev.typescript !== floor.typescript) {
    problems.push(
      `typescript dev dependency must use compiler floor ${floor.typescript}; found ${String(dev.typescript ?? "missing")}`,
    );
  }

  return problems;
}

/**
 * Creates a consumer that installs the packed library against one exact
 * framework toolchain. Overrides are restricted to local CopilotKit siblings;
 * Angular itself always resolves normally so peer incompatibilities fail CI.
 */
export function createAngularConsumerManifest({
  angularTarball,
  packageManager,
  siblingTarballs,
  support,
  rxjs,
}: AngularConsumerManifestOptions): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    name: `copilotkit-angular-${support.major}-consumer`,
    version: "0.0.0",
    private: true,
    dependencies: {
      "@angular/cdk": support.cdk,
      "@angular/common": support.angular,
      "@angular/core": support.angular,
      "@angular/platform-browser": support.angular,
      "@copilotkit/angular": `file:${angularTarball}`,
      rxjs,
      tslib: "^2.8.1",
    },
    devDependencies: {
      "@angular/build": support.angular,
      "@angular/cli": support.angular,
      "@angular/compiler": support.angular,
      "@angular/compiler-cli": support.angular,
      typescript: support.typescript,
    },
    packageManager,
  };

  if (siblingTarballs.size) {
    manifest.pnpm = {
      overrides: Object.fromEntries(
        [...siblingTarballs].map(([name, tarball]) => [
          name,
          `file:${tarball}`,
        ]),
      ),
    };
  }

  return manifest;
}

/**
 * Creates the smallest production-built, zoneless, standalone Angular app
 * that imports and renders a public CopilotKit Angular component.
 */
export function createAngularConsumerSources(): ReadonlyMap<string, string> {
  return new Map([
    [
      "angular.json",
      `${JSON.stringify(
        {
          version: 1,
          projects: {
            smoke: {
              projectType: "application",
              root: "",
              sourceRoot: "src",
              architect: {
                build: {
                  builder: "@angular/build:application",
                  options: {
                    browser: "src/main.ts",
                    index: "src/index.html",
                    outputPath: "dist/smoke",
                    tsConfig: "tsconfig.app.json",
                  },
                  configurations: {
                    production: {
                      optimization: true,
                      outputHashing: "all",
                      sourceMap: false,
                    },
                  },
                  defaultConfiguration: "production",
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    ],
    [
      "tsconfig.json",
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            target: "ES2022",
            module: "preserve",
            moduleResolution: "bundler",
            experimentalDecorators: true,
            importHelpers: true,
            skipLibCheck: false,
          },
          angularCompilerOptions: {
            strictInjectionParameters: true,
            strictTemplates: true,
          },
        },
        null,
        2,
      )}\n`,
    ],
    [
      "tsconfig.app.json",
      `${JSON.stringify(
        {
          extends: "./tsconfig.json",
          compilerOptions: { outDir: "./out-tsc/app" },
          angularCompilerOptions: {
            strictInjectionParameters: true,
            strictTemplates: true,
          },
          files: ["src/main.ts"],
        },
        null,
        2,
      )}\n`,
    ],
    [
      "src/index.html",
      "<!doctype html><html><body><copilot-smoke></copilot-smoke></body></html>\n",
    ],
    [
      "src/main.ts",
      `import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app";

bootstrapApplication(App, {
  providers: [provideZonelessChangeDetection()],
}).catch((error: unknown) => {
  console.error(error);
});
`,
    ],
    [
      "src/app.ts",
      `import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CopilotA2UIProgress } from "@copilotkit/angular";

@Component({
  selector: "copilot-smoke",
  imports: [CopilotA2UIProgress],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<copilot-a2ui-progress [phase]="0" aria-label="CopilotKit loaded" />',
})
export class App {}
`,
    ],
  ]);
}

/** Returns forbidden packages resolved anywhere in a consumer dependency tree. */
export function findPackageResolutions(
  trees: readonly DependencyNode[],
  forbidden: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  const queue = [...trees];

  while (queue.length) {
    const node = queue.shift();
    if (!node) break;
    if (node.name && forbidden.has(node.name)) {
      found.add(`${node.name}@${node.version ?? "unknown"}`);
    }
    for (const dependencies of [
      node.dependencies,
      node.devDependencies,
      node.optionalDependencies,
    ]) {
      for (const [name, child] of Object.entries(dependencies ?? {})) {
        if (forbidden.has(name)) {
          found.add(`${name}@${child.version ?? "unknown"}`);
        }
        queue.push(child);
      }
    }
  }

  return [...found].sort();
}
