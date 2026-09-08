import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { globSync } from "glob";
import { expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

/**
 * `src/app/demos/layout.tsx` reads `manifest.yaml` from `process.cwd()` inside
 * `generateMetadata()`, but only once `headers()` returns an `x-pathname` — and
 * only `src/middleware.ts` sets that header. So an integration that ships the
 * middleware opts every `/demos/*` route into dynamic rendering AND into a
 * request-time `readFileSync` of `manifest.yaml`. If the Dockerfile's runner
 * stage doesn't copy the manifest, every demo page 500s with "An error occurred
 * in the Server Components render" (ENOENT) while the statically-prerendered
 * home page keeps returning 200 — which reads on the dashboard as "UI is up,
 * every cell stuck at D3". This bit langgraph-python once and ms-agent-dotnet
 * once (PR #6130); this test is the ratchet.
 */
const integrationsWithMiddleware = globSync(
  "showcase/integrations/*/src/middleware.ts",
  {
    cwd: repositoryRoot,
    posix: true,
  },
).map((match) => match.split("/")[2]);

test("integrations that ship middleware.ts exist", () => {
  expect(integrationsWithMiddleware.length).toBeGreaterThan(0);
});

test.each(integrationsWithMiddleware)(
  "%s copies manifest.yaml into the runtime image",
  (integration) => {
    const dir = resolve(repositoryRoot, "showcase/integrations", integration);
    // Only integrations whose demos layout actually reads the manifest need it.
    const layout = resolve(dir, "src/app/demos/layout.tsx");
    if (
      !existsSync(layout) ||
      !readFileSync(layout, "utf8").includes("manifest.yaml")
    ) {
      return;
    }

    const dockerfile = readFileSync(resolve(dir, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^COPY .*manifest\.yaml/m);
  },
);
