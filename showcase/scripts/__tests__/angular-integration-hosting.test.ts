import { lstat, readFile, readlink } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

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

describe("Angular integration hosting contract", () => {
  it.each(integrations)(
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

  it.each(integrations)(
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

  it("stages a bounded same-origin runtime manifest", async () => {
    const staging = await readFile(
      resolve(repositoryRoot, "showcase/scripts/cli/_common.sh"),
      "utf8",
    );

    expect(staging).toContain("angular_link/runtime-config.js");
    expect(staging).toContain("integrationId");
    expect(staging).not.toContain("SHOWCASE_ANGULAR_FRONTEND_URL");
    expect(staging).not.toContain("ANGULAR_BACKEND_URL");
  });

  it("has no dedicated Angular host, image, proxy, or server", async () => {
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

  it("builds once and tests both proof images only in CI", async () => {
    const workflow = await readFile(
      resolve(
        repositoryRoot,
        ".github/workflows/test_showcase-angular-proof.yml",
      ),
      "utf8",
    );

    expect(workflow.match(/pnpm --dir showcase\/angular build/g)).toHaveLength(
      1,
    );
    expect(workflow).toContain(
      "matrix:\n        integration: [langgraph-python, mastra]",
    );
    expect(workflow).toContain("actions/upload-artifact");
    expect(workflow).toContain("actions/download-artifact");
    expect(workflow).toContain(
      '"$GITHUB_WORKSPACE/showcase/harness/config/frontend-matrix-baseline.json"',
    );
    expect(workflow).toContain(
      '"$GITHUB_WORKSPACE/showcase/harness/config/frontend-matrix-baseline-policy.json"',
    );
    expect(workflow).not.toContain("showcase/angular/Dockerfile");
    expect(workflow).not.toMatch(/railway|deploy|push: true/i);
  });

  it("checks the shared artifact in every existing integration image", async () => {
    const workflow = await readFile(
      resolve(
        repositoryRoot,
        ".github/workflows/test_showcase-angular-proof.yml",
      ),
      "utf8",
    );

    expect(workflow).toContain(
      "name: Angular hosting / ${{ matrix.integration }}",
    );
    for (const integration of integrations) {
      expect(workflow).toContain(`- ${integration}`);
    }
    expect(workflow).toContain("/angular/agentic-chat");
    expect(workflow).toContain("angular-proof-browser");
  });
});
