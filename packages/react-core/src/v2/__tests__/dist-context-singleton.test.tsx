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

/**
 * End-to-end reproduction of the duplicated-context bug, against the BUILT dist
 * across the two public entry points — exactly how a consumer app wires it:
 *
 *   provider <- @copilotkit/react-core/v2         (shared chunk)
 *   hook     <- @copilotkit/react-core/v2/context (standalone entry)
 *
 * When `src/v2/context.ts` is bundled into both, `createContext()` runs twice:
 * the provider publishes to its inlined copy while the subpath serves an
 * orphaned one, so this test sees `null` instead of the server-reported status.
 *
 * The hard gate for that regression is `scripts/context-singleton-preflight.mjs`,
 * which runs as part of `build`. This test is extra confidence and is skipped
 * when dist is absent, because `test` does not depend on this package's own
 * `build` (nx `test.dependsOn` is `^build` — upstream only).
 */
const pkgRoot = path.resolve(__dirname, "../../..");
const distEntry = path.join(pkgRoot, "dist/v2/index.mjs");
const distContext = path.join(pkgRoot, "dist/v2/context.mjs");
// dist/v2/index.mjs has a side-effect `import "./index.css"`, emitted by
// `build:css`. Without it the import fails for a reason unrelated to this test.
const distCss = path.join(pkgRoot, "dist/v2/index.css");

const distReady =
  fs.existsSync(distEntry) &&
  fs.existsSync(distContext) &&
  fs.existsSync(distCss);

if (!distReady) {
  console.warn(
    "[dist-context-singleton] SKIPPED — no built dist found. " +
      "Run `pnpm build` in packages/react-core to exercise this test. " +
      "The build-time guard (scripts/context-singleton-preflight.mjs) still covers this regression.",
  );
}

function mockInfo(licenseStatus?: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      version: "1.0.0",
      agents: {},
      audioFileTranscriptionEnabled: false,
      mode: "intelligence",
      licenseStatus,
    }),
  });
}

describe.skipIf(!distReady)(
  "dist: /v2 provider -> /v2/context consumer",
  () => {
    let CopilotKitProvider: React.ComponentType<any>;
    let LicenseProbe: React.ComponentType;

    beforeAll(async () => {
      // Paths are computed, and @vite-ignore'd, so a missing dist cannot break
      // transform-time analysis for the skipped case.
      const entryMod = await import(
        /* @vite-ignore */ new URL(`file://${distEntry}`).href
      );
      const contextMod = await import(
        /* @vite-ignore */ new URL(`file://${distContext}`).href
      );
      CopilotKitProvider = entryMod.CopilotKitProvider;
      const useLicenseContext = contextMod.useLicenseContext;
      LicenseProbe = () => {
        const { status } = useLicenseContext();
        return <div data-testid="status">{String(status)}</div>;
      };
    });

    let originalFetch: typeof globalThis.fetch;
    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it.each(["valid", "expired"])(
      "useLicenseContext sees server-reported '%s', not the default",
      async (status) => {
        globalThis.fetch = mockInfo(status) as any;
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
