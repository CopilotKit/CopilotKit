import { createRequire } from "node:module";
import type {
  QuickJSSyncVariant,
  QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { QUICKJS_WASM_BASE64 } from "./quickjs-wasm.generated";

/**
 * How the loader reaches the module system. `createRequire(...)` returns
 * exactly this shape; a test can pass its own.
 */
export interface RequireLike {
  (specifier: string): any;
  resolve(specifier: string): string;
}

const VARIANT = "@jitl/quickjs-wasmfile-release-sync";

/**
 * Load the QuickJS sandbox so that it also works when an app bundles the
 * runtime, as a Next.js server does unless the app lists
 * `@copilotkit/runtime` in `serverExternalPackages`.
 *
 * Two things in the published QuickJS packages break in a bundled server:
 * - Their ESM build reads `createRequire` from `await import("node:module")`.
 *   Webpack's stand-in for that import copies properties only from objects,
 *   and `node:module` exports a function, so the call fails with
 *   "a is not a function".
 * - They find the WebAssembly as a file next to the module, and a bundled or
 *   traced server may not have it there.
 *
 * So the loader takes the CommonJS build through `createRequire`, which
 * bundlers treat as a static `require`, and it passes the WebAssembly bytes
 * itself, from a generated module. `createRequire(import.meta.url)` runs only
 * when a script runs, never at module load: Cloudflare Workers leave
 * `import.meta.url` undefined.
 *
 * @param requireFrom - The module system to load QuickJS from.
 * @returns The QuickJS module.
 */
export async function loadQuickJS(
  requireFrom: RequireLike = createRequire(import.meta.url) as RequireLike,
): Promise<QuickJSWASMModule> {
  try {
    const core = requireFrom("quickjs-emscripten-core");
    const variant: QuickJSSyncVariant = {
      type: "sync",
      importFFI: async () => requireFrom(`${VARIANT}/ffi`).QuickJSFFI,
      importModuleLoader: async () => {
        const loaded = requireFrom(`${VARIANT}/emscripten-module`);
        return loaded.default ?? loaded;
      },
    };
    const bytes = Buffer.from(QUICKJS_WASM_BASE64, "base64");
    const wasmBinary = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return await core.newQuickJSWASMModuleFromVariant(
      core.newVariant(variant, { wasmBinary }),
    );
  } catch (cause) {
    throw new Error(
      "@copilotkit/runtime: the skill-script sandbox (QuickJS) did not load. " +
        "If your app bundles @copilotkit/runtime, list it in your bundler's " +
        "server externals (in Next.js, `serverExternalPackages`).",
      { cause },
    );
  }
}
