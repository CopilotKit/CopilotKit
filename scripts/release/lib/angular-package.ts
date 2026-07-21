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
    scripts: {
      build: "ng build --configuration=production",
      "serve:ssr": "node dist/smoke/server/server.mjs",
    },
    dependencies: {
      "@ag-ui/client": "0.0.57",
      "@angular/cdk": support.cdk,
      "@angular/common": support.angular,
      "@angular/core": support.angular,
      "@angular/platform-browser": support.angular,
      "@angular/platform-server": support.angular,
      "@angular/router": support.angular,
      "@angular/ssr": support.angular,
      "@copilotkit/angular": `file:${angularTarball}`,
      express: "^5.1.0",
      rxjs,
      tslib: "^2.8.1",
      zod: "^3.25.75",
    },
    devDependencies: {
      "@angular/build": support.angular,
      "@angular/cli": support.angular,
      "@angular/compiler": support.angular,
      "@angular/compiler-cli": support.angular,
      "@types/express": "^5.0.1",
      "@types/node": "^22.5.1",
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
 * Creates a strict, production-built, zoneless Angular SSR application that
 * exercises the package's chat, popup, tool-rendering, and cleanup contracts.
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
                    server: "src/main.server.ts",
                    ssr: { entry: "src/server.ts" },
                    outputMode: "server",
                    security: { allowedHosts: [] },
                    styles: ["src/styles.css"],
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
            noImplicitOverride: true,
            noImplicitReturns: true,
            noFallthroughCasesInSwitch: true,
            noPropertyAccessFromIndexSignature: true,
            target: "ES2022",
            module: "preserve",
            moduleResolution: "bundler",
            experimentalDecorators: true,
            importHelpers: true,
            isolatedModules: true,
            skipLibCheck: true,
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
          compilerOptions: {
            outDir: "./out-tsc/app",
            types: ["node"],
          },
          angularCompilerOptions: {
            strictInjectionParameters: true,
            strictTemplates: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      )}\n`,
    ],
    [
      "src/index.html",
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CopilotKit Angular packed smoke</title><base href="/"></head><body><copilot-smoke></copilot-smoke></body></html>\n',
    ],
    [
      "src/main.ts",
      `import { bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app";
import { appConfig } from "./app.config";

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  console.error(error);
});
`,
    ],
    [
      "src/main.server.ts",
      `import { type BootstrapContext, bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app";
import { serverConfig } from "./app.config.server";

const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(App, serverConfig, context);

export default bootstrap;
`,
    ],
    [
      "src/app.config.ts",
      `import {
  type ApplicationConfig,
  provideZonelessChangeDetection,
} from "@angular/core";
import { provideClientHydration, withEventReplay } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { AbstractAgent, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { provideCopilotKit } from "@copilotkit/angular";
import { EMPTY, type Observable } from "rxjs";
import { z } from "zod";
import { SmokeToolRenderer } from "./app";

class SmokeAgent extends AbstractAgent {
  constructor() {
    super();
    this.agentId = "default";
  }

  override run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideClientHydration(withEventReplay()),
    provideRouter([]),
    provideCopilotKit({
      licenseKey: "ck_pub_00000000000000000000000000000000",
      agents: { default: new SmokeAgent() },
      renderToolCalls: [
        {
          name: "packed_smoke_tool",
          args: z.object({ label: z.string() }),
          component: SmokeToolRenderer,
        },
      ],
    }),
  ],
};
`,
    ],
    [
      "src/app.config.server.ts",
      `import { type ApplicationConfig, mergeApplicationConfig } from "@angular/core";
import { provideServerRendering, withRoutes } from "@angular/ssr";
import { appConfig } from "./app.config";
import { serverRoutes } from "./app.routes.server";

const ssrConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
};

export const serverConfig = mergeApplicationConfig(appConfig, ssrConfig);
`,
    ],
    [
      "src/app.routes.server.ts",
      `import { RenderMode, type ServerRoute } from "@angular/ssr";

export const serverRoutes: ServerRoute[] = [
  { path: "**", renderMode: RenderMode.Server },
];
`,
    ],
    [
      "src/server.ts",
      `import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from "@angular/ssr/node";
import express from "express";
import { join } from "node:path";

const browserDistFolder = join(import.meta.dirname, "../browser");
const app = express();
const angularApp = new AngularNodeAppEngine();

app.use(
  express.static(browserDistFolder, {
    maxAge: "1y",
    index: false,
    redirect: false,
  }),
);

app.use((request, response, next) => {
  angularApp
    .handle(request)
    .then((result) =>
      result ? writeResponseToNodeResponse(result, response) : next(),
    )
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env["pm_id"]) {
  const port = process.env["PORT"] ?? "4000";
  app.listen(port, (error) => {
    if (error) throw error;
    console.log("CopilotKit Angular packed smoke listening on http://127.0.0.1:" + port);
  });
}

export const requestHandler = createNodeRequestHandler(app);
`,
    ],
    [
      "src/app.ts",
      `import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
} from "@angular/core";
import type { AssistantMessage, Message } from "@ag-ui/client";
import {
  type AngularToolCall,
  CopilotKit,
  CopilotPopup,
  RenderToolCalls,
  type ToolRenderer,
  registerFrontendTool,
} from "@copilotkit/angular";
import { z } from "zod";

interface SmokeToolArgs extends Record<string, unknown> {
  label: string;
}

@Component({
  selector: "packed-smoke-tool-renderer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: \`
    <output data-testid="tool-renderer">
      {{ toolCall().args.label }}:{{ toolCall().status }}
    </output>
  \`,
})
export class SmokeToolRenderer implements ToolRenderer<SmokeToolArgs> {
  readonly toolCall = input.required<AngularToolCall<SmokeToolArgs>>();
}

@Component({
  selector: "packed-lifecycle-probe",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<span data-testid="lifecycle-probe">registered</span>',
})
class LifecycleProbe {
  constructor() {
    registerFrontendTool({
      name: "packed_lifecycle_tool",
      description: "Verifies destroy-scoped frontend tool cleanup",
      parameters: z.object({ value: z.string() }),
      handler: async ({ value }) => ({ value }),
    });
  }
}

@Component({
  selector: "copilot-smoke",
  imports: [CopilotPopup, LifecycleProbe, RenderToolCalls],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: \`
    <main data-testid="ssr-smoke">
      <h1>CopilotKit Angular packed consumer</h1>
      <p data-testid="lifecycle-count">
        {{ copilotKit.clientToolCallRenderConfigs().length }}
      </p>
      <button type="button" data-testid="destroy-probe" (click)="showProbe.set(false)">
        Destroy lifecycle probe
      </button>
      @if (showProbe()) {
        <packed-lifecycle-probe />
      }
      <copilot-render-tool-calls
        [message]="assistantMessage"
        [messages]="messages"
      />
      <copilot-popup [(open)]="popupOpen" title="Packed consumer chat" />
    </main>
  \`,
})
export class App {
  readonly copilotKit = inject(CopilotKit);
  readonly #host = inject(ElementRef<HTMLElement>);
  readonly popupOpen = signal(false);
  readonly showProbe = signal(true);
  readonly assistantMessage: AssistantMessage = {
    id: "assistant-smoke",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "tool-call-smoke",
        type: "function",
        function: {
          name: "packed_smoke_tool",
          arguments: JSON.stringify({ label: "packed" }),
        },
      },
    ],
  };
  readonly messages: Message[] = [
    this.assistantMessage,
    {
      id: "tool-result-smoke",
      role: "tool",
      toolCallId: "tool-call-smoke",
      content: "complete",
    },
  ];

  constructor() {
    afterNextRender(() => {
      this.#host.nativeElement.setAttribute("data-hydrated", "true");
    });
  }
}
`,
    ],
    [
      "src/styles.css",
      `html { font-family: sans-serif; }
body { margin: 0; }
`,
    ],
  ]);
}

/** Validates that the fixture response contains content rendered on the server. */
export function validateAngularSsrHtml(html: string): string[] {
  const problems: string[] = [];
  if (!html.includes('data-testid="ssr-smoke"')) {
    problems.push('SSR response is missing data-testid="ssr-smoke"');
  }
  if (!html.includes('data-testid="tool-renderer"')) {
    problems.push('SSR response is missing data-testid="tool-renderer"');
  }
  if (!html.includes("packed:complete")) {
    problems.push("SSR response is missing the completed packed tool result");
  }
  return problems;
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
