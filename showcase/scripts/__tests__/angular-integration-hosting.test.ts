import { lstat, readFile, readlink } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const integrations = [
  "ag2",
  "agno",
  "built-in-agent",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "crewai-crews",
  "google-adk",
  "langgraph-fastapi",
  "langgraph-python",
  "langgraph-typescript",
  "langroid",
  "llamaindex",
  "mastra",
  "ms-agent-dotnet",
  "ms-agent-harness-dotnet",
  "ms-agent-python",
  "pydantic-ai",
  "spring-ai",
  "strands",
  "strands-typescript",
] as const;

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
  "serves Angular deep links from the existing %s image",
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
  expect(staging).not.toContain("SHOWCASE_ANGULAR_FRONTEND_URL");
  expect(staging).not.toContain("ANGULAR_BACKEND_URL");
});

test.each(["showcase_build.yml", "showcase_build_check.yml"])(
  "materializes the canonical Angular browser artifact in %s",
  async (workflowFile) => {
    const workflow = await readFile(
      resolve(repositoryRoot, ".github/workflows", workflowFile),
      "utf8",
    );

    expect(workflow).toContain("needs_angular");
    expect(workflow).toContain("- 'packages/angular/**'");
    expect(workflow).toContain('$changes | index("angular")');
    expect(workflow).toContain("Build canonical Angular browser artifact");
    expect(workflow).toContain("Download canonical Angular browser artifact");
    expect(workflow).toContain('stage_angular "$CONTEXT" "$ANGULAR_BROWSER"');
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

test("does not run the broad Angular proof matrix in pull requests", async () => {
  await expect(
    lstat(
      resolve(
        repositoryRoot,
        ".github/workflows/test_showcase-angular-proof.yml",
      ),
    ),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("keeps the exhaustive Angular audit opt-in, complete, and fail-closed", async () => {
  const workflow = await readFile(
    resolve(
      repositoryRoot,
      ".github/workflows/test_showcase-angular-audit.yml",
    ),
    "utf8",
  );

  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("types: [labeled]");
  expect(workflow).toContain("github.event.label.name == 'angular-audit'");
  expect(workflow).not.toContain("types: [opened");
  expect(workflow).not.toContain("types: [synchronize");
  for (const integration of integrations) {
    expect(workflow).toContain(`          - ${integration}`);
  }
  expect(workflow).toContain(
    "pnpm nx run @copilotkit/showcase-angular-host:build --skip-nx-cache",
  );
  expect(workflow).toContain(
    "ref: ${{ github.event.pull_request.head.sha || github.sha }}",
  );
  expect(workflow).toContain("Run every paired Chromium cell");
  expect(workflow).toContain('--feature-contract-revision "$SOURCE_SHA"');
  expect(workflow).toContain("--concurrency 1");
  expect(workflow).toContain("frontend-matrix-ci.ts aggregate");
  expect(workflow).toContain(
    '.summary.total "$RUNNER_TEMP/angular-audit-final.json")" = "1296"',
  );
  expect(workflow).toContain(
    '.summary.failed "$RUNNER_TEMP/angular-audit-final.json")" = "0"',
  );
  expect(workflow).not.toContain("frontend-matrix-baseline");
  expect(workflow).not.toContain("frontend-matrix-ci.ts compare");
});
