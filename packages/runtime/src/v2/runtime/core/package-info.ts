// The runtime's own name and version, without importing package.json.
//
// A JSON import compiles to a CommonJS wrapper, and that wrapper pulls in the
// bundler's shared helper module, which runs `createRequire(import.meta.url)` at
// load. Cloudflare Workers leave `import.meta.url` undefined, so that call threw
// before the Worker could serve a request (#6919).
//
// The version is injected instead: tsdown.config.ts sets it for the build and
// vitest.config.mjs for tests. Code that runs this source with neither (the
// ts-node schema generator) gets the placeholder. The packed-package check in
// scripts/release/verify-runtime-package.ts fails if a published build carries
// the placeholder instead of the real version.
declare const __COPILOTKIT_RUNTIME_VERSION__: string | undefined;

export const RUNTIME_PACKAGE_NAME = "@copilotkit/runtime";
export const RUNTIME_PACKAGE_VERSION: string =
  typeof __COPILOTKIT_RUNTIME_VERSION__ === "string"
    ? __COPILOTKIT_RUNTIME_VERSION__
    : "0.0.0-unbuilt";
