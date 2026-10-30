import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/**
 * End-to-end reproduction of the duplicated-context bug, against the BUILT dist
 * across the public entry points — exactly how a consumer app wires it:
 *
 *   provider <- @copilotkit/react-core                 (shared chunk)
 *   hook     <- @copilotkit/react-core/context         (standalone entry)
 *   surface  <- @copilotkit/react-core/generative-ui   (shared chunk)
 *
 * When `src/context.ts` is bundled into both, `createContext()` runs twice:
 * the provider publishes to its inlined copy while the subpath serves an
 * orphaned one, so this test sees `null` instead of the server-reported status.
 * The same holds for `generative-ui/runtime-context.ts`: when `/v2` and
 * `/v2/generative-ui` each carry a copy, `GenerativeUISurface` does not see the
 * runtime that `CopilotKitProvider` sets, and it throws.
 *
 * The hard gate for the `/v2/context` regression is
 * `scripts/context-singleton-preflight.mjs`, which runs as part of `build`.
 * This test is extra confidence and is skipped when dist is absent, because
 * `test` does not depend on this package's own `build` (nx `test.dependsOn` is
 * `^build` — upstream only).
 */
const pkgRoot = path.resolve(__dirname, "../..");
const distEntry = path.join(pkgRoot, "dist/v2/index.mjs");
const distContext = path.join(pkgRoot, "dist/v2/context.mjs");
const distGenerativeUI = path.join(pkgRoot, "dist/v2/generative-ui.mjs");

/**
 * True when `file` and every chunk it imports, recursively, are on disk. Nx can
 * run this test while the same package's `build` is rewriting dist (publint and
 * attw depend on it), so an entry can exist before the chunks it loads.
 */
function builtWithChunks(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return true;
  seen.add(file);
  if (!fs.existsSync(file)) return false;
  const code = fs.readFileSync(file, "utf8");
  for (const [, specifier] of code.matchAll(
    /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g,
  )) {
    const chunk = path.resolve(path.dirname(file), specifier!);
    if (!builtWithChunks(chunk, seen)) return false;
  }
  return true;
}

const distReady = builtWithChunks(distEntry) && builtWithChunks(distContext);
const generativeUIReady = distReady && builtWithChunks(distGenerativeUI);

if (!generativeUIReady) {
  console.warn(
    "[dist-context-singleton] SKIPPED (in part or in full) — no built dist found. " +
      "Run `pnpm build` in packages/react-core to exercise this test. " +
      "The build-time guard (scripts/context-singleton-preflight.mjs) still covers the /v2/context regression.",
  );
}

/**
 * Imports a built file. The path is computed, and @vite-ignore'd, so a
 * missing dist cannot break transform-time analysis for the skipped case.
 */
function importBuilt(file: string) {
  return import(/* @vite-ignore */ pathToFileURL(file).href);
}

// The built entries. The source modules give their types.
let entry: typeof import("../index");
let context: typeof import("../context");
let generativeUI: typeof import("../generative-ui");

/** Answers the runtime info request, with this license status. */
function mockRuntimeInfo(licenseStatus?: string) {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          version: "1.0.0",
          agents: {},
          audioFileTranscriptionEnabled: false,
          mode: "intelligence",
          licenseStatus,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
}

beforeEach(() => {
  mockRuntimeInfo();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe.skipIf(!distReady)(
  "dist: /v2 provider -> /v2/context consumer",
  () => {
    beforeAll(async () => {
      entry = await importBuilt(distEntry);
      context = await importBuilt(distContext);
    }, 30_000);

    function LicenseProbe() {
      const { status } = context.useLicenseContext();
      return <div data-testid="status">{String(status)}</div>;
    }

    it.each(["valid", "expired"])(
      "useLicenseContext sees server-reported '%s', not the default",
      async (status) => {
        mockRuntimeInfo(status);
        const { CopilotKitProvider } = entry;
        render(
          <CopilotKitProvider runtimeUrl="/api">
            <LicenseProbe />
          </CopilotKitProvider>,
        );
        await waitFor(() => {
          expect(screen.getByTestId("status").textContent).toBe(status);
        });
      },
    );
  },
);

describe.skipIf(!generativeUIReady)(
  "dist: /v2 provider -> /v2/generative-ui surface",
  () => {
    beforeAll(async () => {
      entry = await importBuilt(distEntry);
      generativeUI = await importBuilt(distGenerativeUI);
    }, 30_000);

    it("renders a GenerativeUISurface from the subpath inside the provider from /v2", async () => {
      const { CopilotKitProvider } = entry;
      const { GenerativeUISurface, standardUI } = generativeUI;
      render(
        <CopilotKitProvider runtimeUrl="/api" generativeUI={{ ui: standardUI }}>
          <GenerativeUISurface
            id="main"
            fallback={<div data-testid="fallback">No surface yet</div>}
          />
        </CopilotKitProvider>,
      );
      expect((await screen.findByTestId("fallback")).textContent).toBe(
        "No surface yet",
      );
    });
  },
);
