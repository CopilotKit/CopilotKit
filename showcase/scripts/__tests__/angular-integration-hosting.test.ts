import { lstat, readFile, readlink } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const integrationsRoot = resolve(repositoryRoot, "showcase/integrations");
const integrations = readdirSync(integrationsRoot, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(resolve(integrationsRoot, entry.name, "next.config.ts")),
  )
  .map((entry) => entry.name)
  .sort();

test.each(integrations)(
  "stages the one canonical browser build into %s",
  async (integration) => {
    const link = resolve(
      repositoryRoot,
      "showcase/integrations",
      integration,
      "public/angular",
    );

    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(
      "../../../angular/dist/showcase-angular/browser",
    );
  },
);

test.each(integrations)(
  "stages the one canonical Vue browser build into %s",
  async (integration) => {
    const link = resolve(integrationsRoot, integration, "public/vue");

    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe("../../../vue/dist");
  },
);

test.each(integrations)(
  "serves secondary-frontend deep links from the existing %s image",
  async (integration) => {
    const config = await readFile(
      resolve(
        repositoryRoot,
        "showcase/integrations",
        integration,
        "next.config.ts",
      ),
      "utf8",
    );

    expect(config).toContain('source: "/angular/:path*"');
    expect(config).toContain('destination: "/angular/index.html"');
    expect(config).toContain('source: "/vue/:path*"');
    expect(config).toContain('destination: "/vue/index.html"');
    expect(config).not.toContain("/react/:path*");
  },
);

test("stages a bounded same-origin runtime manifest", async () => {
  const staging = await readFile(
    resolve(repositoryRoot, "showcase/scripts/cli/_common.sh"),
    "utf8",
  );

  expect(staging).toContain("angular_link/runtime-config.js");
  expect(staging).toContain("integrationId");
  expect(staging).toContain("vue_link/runtime-config.js");
  expect(staging).toContain(
    'Object.freeze({\\"frontendId\\":\\"vue\\",\\"integrationId\\":\\"$integration_id\\"})',
  );
  expect(staging).not.toContain("SHOWCASE_ANGULAR_FRONTEND_URL");
  expect(staging).not.toContain("ANGULAR_BACKEND_URL");
  expect(staging).not.toContain("VUE_BACKEND_URL");
});

test.each(["showcase_build.yml", "showcase_build_check.yml"])(
  "materializes the canonical Angular browser artifact in %s",
  async (workflowFile) => {
    const workflow = await readFile(
      resolve(repositoryRoot, ".github/workflows", workflowFile),
      "utf8",
    );
    const eventTriggers = workflow.slice(0, workflow.indexOf("\njobs:"));

    expect(workflow).toContain("needs_angular");
    expect(workflow).toContain("needs_vue");
    expect(eventTriggers).toContain('- "packages/vue/**"');
    expect(eventTriggers).toContain('- "packages/web-inspector/**"');
    expect(workflow).toContain("- 'packages/angular/**'");
    expect(workflow).toContain('$changes | index("angular")');
    expect(workflow).toContain("Build canonical Angular browser artifact");
    expect(workflow).toContain("Download canonical Angular browser artifact");
    expect(workflow).toContain('stage_angular "$CONTEXT" "$ANGULAR_BROWSER"');
    expect(workflow).toContain("Build canonical Vue browser artifact");
    expect(workflow).toContain("Download canonical Vue browser artifact");
    expect(workflow).toContain('stage_vue "$CONTEXT" "$VUE_BROWSER"');
  },
);

test("has no dedicated Angular host, image, proxy, or server", async () => {
  const packageJson = JSON.parse(
    await readFile(
      resolve(repositoryRoot, "showcase/angular/package.json"),
      "utf8",
    ),
  ) as { scripts?: Record<string, string> };

  expect(packageJson.scripts).not.toHaveProperty("start");
  await expect(
    lstat(resolve(repositoryRoot, "showcase/angular/Dockerfile")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    lstat(resolve(repositoryRoot, "showcase/angular/server")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("generates shell-docs data before tests on a fresh checkout", async () => {
  const packageJson = JSON.parse(
    await readFile(
      resolve(repositoryRoot, "showcase/shell-docs/package.json"),
      "utf8",
    ),
  ) as { scripts?: Record<string, string> };

  expect(packageJson.scripts?.pretest).toBe("npm run pretypecheck");
});
test("generates Angular source content in the shell-docs image", async () => {
  const dockerfile = await readFile(
    resolve(repositoryRoot, "showcase/shell-docs/Dockerfile"),
    "utf8",
  );

  expect(dockerfile).toContain("COPY showcase/angular/src/ ./angular/src/");
  expect(dockerfile).toContain(
    "node node_modules/tsx/dist/cli.mjs bundle-angular-source-content.ts",
  );
});

test("generates Vue source content in the shell image", async () => {
  const dockerfile = await readFile(
    resolve(repositoryRoot, "showcase/shell/Dockerfile"),
    "utf8",
  );

  expect(dockerfile).toContain("COPY showcase/vue/src/ ./vue/src/");
  expect(dockerfile).toContain(
    "node node_modules/tsx/dist/cli.mjs bundle-vue-source-content.ts",
  );
});
