import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADAPTER_PACKAGES,
  detectAdapterVersion,
  formatDetectorOutputs,
  type AdapterPackageId,
} from "./detect-intelligence-adapter-version-changes.js";

const EXPECTED_PACKAGES = [
  {
    id: "copilotkit-intelligence-adk",
    registry: "pypi",
    directory: "sdk-python-adk",
    manifest: "sdk-python-adk/pyproject.toml",
    tagPrefix: "intelligence-adk-python/v",
  },
  {
    id: "copilotkit-intelligence-langgraph",
    registry: "pypi",
    directory: "sdk-python-langgraph",
    manifest: "sdk-python-langgraph/pyproject.toml",
    tagPrefix: "intelligence-langgraph-python/v",
  },
  {
    id: "@copilotkit/intelligence-langgraph",
    registry: "npm",
    directory: "packages/intelligence-langgraph",
    manifest: "packages/intelligence-langgraph/package.json",
    tagPrefix: "intelligence-langgraph/v",
  },
  {
    id: "copilotkit-intelligence-agent-framework",
    registry: "pypi",
    directory: "sdk-python-agent-framework",
    manifest: "sdk-python-agent-framework/pyproject.toml",
    tagPrefix: "intelligence-agent-framework-python/v",
  },
  {
    id: "CopilotKit.Intelligence.AgentFramework",
    registry: "nuget",
    directory: "sdk-dotnet-agent-framework",
    manifest:
      "sdk-dotnet-agent-framework/CopilotKit.Intelligence.AgentFramework/CopilotKit.Intelligence.AgentFramework.csproj",
    tagPrefix: "intelligence-agent-framework-dotnet/v",
  },
] as const;

const PUBLISH_WORKFLOW = fs.readFileSync(
  path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../.github/workflows/publish-release.yml",
  ),
  "utf8",
);

function workflowJob(job: string, nextJob: string): string {
  const start = PUBLISH_WORKFLOW.indexOf(`  ${job}:\n`);
  const end = PUBLISH_WORKFLOW.indexOf(`  ${nextJob}:\n`, start + 1);
  expect(start, `${job} must exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${nextJob} must follow ${job}`).toBeGreaterThan(start);
  return PUBLISH_WORKFLOW.slice(start, end);
}

const tempDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryRoot(manifest: string, contents: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adapter-detector-"));
  tempDirectories.push(root);
  const manifestPath = path.join(root, manifest);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, contents);
  return root;
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Intelligence adapter package table", () => {
  it("maps all five exact package identities to independent release metadata", () => {
    expect(ADAPTER_PACKAGES).toEqual(EXPECTED_PACKAGES);
    expect(new Set(ADAPTER_PACKAGES.map(({ id }) => id)).size).toBe(5);
    expect(
      new Set(ADAPTER_PACKAGES.map(({ tagPrefix }) => tagPrefix)).size,
    ).toBe(5);
  });

  it.each(EXPECTED_PACKAGES)(
    "reads $id from only its declared manifest",
    async ({ id, directory, tagPrefix }) => {
      const result = await detectAdapterVersion(id, {
        registryFixturePath:
          "scripts/release/fixtures/intelligence-adapters-unpublished.json",
      });

      expect(result).toMatchObject({
        shouldPublish: true,
        name: id,
        version: "0.1.0",
        directory,
        tagPrefix,
        concurrencyKey: `${id}@0.1.0`,
      });
    },
  );

  it("rejects unknown package IDs", async () => {
    await expect(
      detectAdapterVersion(
        "copilotkit-intelligence-unknown" as AdapterPackageId,
        {
          registryFixturePath:
            "scripts/release/fixtures/intelligence-adapters-unpublished.json",
        },
      ),
    ).rejects.toThrow(/unknown Intelligence adapter package/i);
  });
});

describe("manifest validation", () => {
  it("fails loud on a malformed manifest", async () => {
    const root = temporaryRoot("sdk-python-adk/pyproject.toml", "not toml");
    await expect(
      detectAdapterVersion("copilotkit-intelligence-adk", {
        root,
        registryFixturePath:
          "scripts/release/fixtures/intelligence-adapters-unpublished.json",
      }),
    ).rejects.toThrow(/malformed manifest/i);
  });

  it("fails loud when manifest identity does not match the package table", async () => {
    const root = temporaryRoot(
      "sdk-python-adk/pyproject.toml",
      '[tool.poetry]\nname = "wrong-package"\nversion = "0.1.0"\n',
    );
    await expect(
      detectAdapterVersion("copilotkit-intelligence-adk", {
        root,
        registryFixturePath:
          "scripts/release/fixtures/intelligence-adapters-unpublished.json",
      }),
    ).rejects.toThrow(/identity mismatch/i);
  });

  it("fails loud on a non-stable SemVer", async () => {
    const root = temporaryRoot(
      "sdk-python-adk/pyproject.toml",
      '[tool.poetry]\nname = "copilotkit-intelligence-adk"\nversion = "0.2.0-rc.1"\n',
    );
    await expect(
      detectAdapterVersion("copilotkit-intelligence-adk", {
        root,
        registryFixturePath:
          "scripts/release/fixtures/intelligence-adapters-unpublished.json",
      }),
    ).rejects.toThrow(/stable SemVer/i);
  });
});

describe("registry comparison", () => {
  it.each([
    ["exact version already published", ["0.1.0"], false],
    ["only lower versions published", ["0.0.9"], true],
  ] as const)(
    "returns the expected decision when %s",
    async (_name, versions, expected) => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, {
          info: { name: "copilotkit-intelligence-adk" },
          releases: Object.fromEntries(
            versions.map((version) => [version, []]),
          ),
        }),
      );

      const result = await detectAdapterVersion("copilotkit-intelligence-adk", {
        fetchImpl,
      });
      expect(result.shouldPublish).toBe(expected);
    },
  );

  it("returns true only for an actual registry 404", async () => {
    const result = await detectAdapterVersion("copilotkit-intelligence-adk", {
      fetchImpl: vi.fn(async () => jsonResponse(404, { message: "not found" })),
    });
    expect(result.shouldPublish).toBe(true);
  });

  it("fails loud when any newer stable publication exists", async () => {
    await expect(
      detectAdapterVersion("copilotkit-intelligence-adk", {
        fetchImpl: vi.fn(async () =>
          jsonResponse(200, {
            info: { name: "copilotkit-intelligence-adk" },
            releases: { "0.1.1": [] },
          }),
        ),
      }),
    ).rejects.toThrow(/newer stable version 0\.1\.1/i);
  });

  it.each([401, 403, 429, 500, 302])(
    "fails loud on registry HTTP %s",
    async (status) => {
      await expect(
        detectAdapterVersion("copilotkit-intelligence-adk", {
          fetchImpl: vi.fn(async () => jsonResponse(status, { error: "no" })),
        }),
      ).rejects.toThrow(new RegExp(`registry HTTP ${status}`, "i"));
    },
  );

  it("fails loud on a transport error", async () => {
    await expect(
      detectAdapterVersion("copilotkit-intelligence-adk", {
        fetchImpl: vi.fn(async () => {
          throw new Error("socket reset");
        }),
      }),
    ).rejects.toThrow(/registry transport failure.*socket reset/i);
  });

  it("fails loud on a malformed registry response", async () => {
    await expect(
      detectAdapterVersion("copilotkit-intelligence-adk", {
        fetchImpl: vi.fn(async () => jsonResponse(200, { releases: [] })),
      }),
    ).rejects.toThrow(/malformed PyPI registry response/i);
  });

  it.each([
    [
      "@copilotkit/intelligence-langgraph",
      {
        name: "@copilotkit/intelligence-langgraph",
        versions: { "0.1.0": {} },
      },
    ],
    ["CopilotKit.Intelligence.AgentFramework", { versions: ["0.1.0"] }],
  ] as const)("detects exact %s publication", async (packageId, body) => {
    const result = await detectAdapterVersion(packageId, {
      fetchImpl: vi.fn(async () => jsonResponse(200, body)),
    });
    expect(result.shouldPublish).toBe(false);
  });

  it("uses fixture mode with zero network access", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network must not be used in fixture mode");
    });
    await detectAdapterVersion("@copilotkit/intelligence-langgraph", {
      fetchImpl,
      registryFixturePath:
        "scripts/release/fixtures/intelligence-adapters-unpublished.json",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("detector output", () => {
  it("emits exactly the five documented output keys in stable order", () => {
    const output = formatDetectorOutputs({
      shouldPublish: true,
      name: "copilotkit-intelligence-adk",
      version: "0.1.0",
      directory: "sdk-python-adk",
      tagPrefix: "intelligence-adk-python/v",
      concurrencyKey: "copilotkit-intelligence-adk@0.1.0",
    });

    expect(output).toBe(
      "should_publish=true\n" +
        "name=copilotkit-intelligence-adk\n" +
        "version=0.1.0\n" +
        "directory=sdk-python-adk\n" +
        "tag_prefix=intelligence-adk-python/v\n",
    );
  });
});

describe("Intelligence adapter release workflow contract", () => {
  it("runs npm package checks, tarball verification, publint, and ATTW", () => {
    const build = workflowJob("build", "publish");
    expect(build).toContain(
      "detect-intelligence-adapter-version-changes.ts --package @copilotkit/intelligence-langgraph",
    );
    expect(build).toContain(
      "pnpm nx run @copilotkit/intelligence-langgraph:check",
    );
    expect(build).toContain(
      "pnpm nx run @copilotkit/intelligence-langgraph:pack-check",
    );
  });

  it.each([
    "build-intelligence-adk-python",
    "build-intelligence-langgraph-python",
    "build-intelligence-agent-framework-python",
  ])("runs %s through version-agnostic artifact acceptance", (job) => {
    const nextJob = job.replace("build-", "publish-");
    const body = workflowJob(job, nextJob);
    expect(body).not.toMatch(/intelligence-[^\s]+:pack-check/);
    expect(body).toMatch(/Verify .* wheel and sdist metadata/);
    expect(body).toContain("wheels=(");
    expect(body).toContain("sdists=(");
  });

  it("runs the .NET package verifier and clean-consumer pack-check", () => {
    const body = workflowJob(
      "build-intelligence-agent-framework-dotnet",
      "publish-intelligence-agent-framework-dotnet",
    );
    expect(body).toContain(
      "pnpm nx run @copilotkit/intelligence-agent-framework-dotnet:pack-check",
    );
  });

  it.each([
    [
      "publish-intelligence-adk-python",
      "build-intelligence-adk-python",
      "build-intelligence-langgraph-python",
    ],
    [
      "publish-intelligence-langgraph-python",
      "build-intelligence-langgraph-python",
      "build-intelligence-agent-framework-python",
    ],
    [
      "publish-intelligence-agent-framework-python",
      "build-intelligence-agent-framework-python",
      "build-intelligence-agent-framework-dotnet",
    ],
    [
      "publish-intelligence-agent-framework-dotnet",
      "build-intelligence-agent-framework-dotnet",
      "notify",
    ],
  ])(
    "%s reconciles exact-version visibility and tags without republishing",
    (publishJob, buildJob, nextJob) => {
      const body = workflowJob(publishJob, nextJob);
      const output = `needs.${buildJob}.outputs.should_publish`;
      expect(body).toContain(`(${output} == 'true' || ${output} == 'false')`);
      expect(body).toContain(`if: ${output} == 'true'`);
      expect(body).toMatch(/- name: Poll (PyPI|NuGet)/);
      expect(body).toMatch(/- name: Tag .* adapter release/);
      expect(
        body.match(new RegExp(`if: ${output} == 'true'`, "g")) ?? [],
      ).toHaveLength(1);
    },
  );

  it("skips only the npm push when the exact stable version exists", () => {
    const publish = workflowJob("publish", "build-python");
    expect(publish).toContain("Poll npm for Intelligence LangGraph adapter");
    expect(publish).toContain(
      "needs.build.outputs.adapter_should_publish == 'true'",
    );
  });

  it.each([
    ["build-intelligence-adk-python", "publish-intelligence-adk-python"],
    [
      "build-intelligence-langgraph-python",
      "publish-intelligence-langgraph-python",
    ],
    [
      "build-intelligence-agent-framework-python",
      "publish-intelligence-agent-framework-python",
    ],
    [
      "build-intelligence-agent-framework-dotnet",
      "publish-intelligence-agent-framework-dotnet",
    ],
  ])(
    "does not let should_publish=false bypass %s acceptance",
    (job, nextJob) => {
      const body = workflowJob(job, nextJob);
      expect(body).not.toMatch(
        /^\s+if: steps\.detect\.outputs\.should_publish == 'true'\s*$/m,
      );
      expect(body).toContain("steps.detect.outputs.should_publish == 'false'");
    },
  );

  it.each([
    ["build", "publish"],
    ["python-adapter-sdk-gate", "build-intelligence-adk-python"],
    ["build-intelligence-adk-python", "publish-intelligence-adk-python"],
    ["publish-intelligence-adk-python", "build-intelligence-langgraph-python"],
    [
      "build-intelligence-langgraph-python",
      "publish-intelligence-langgraph-python",
    ],
    [
      "publish-intelligence-langgraph-python",
      "build-intelligence-agent-framework-python",
    ],
    [
      "build-intelligence-agent-framework-python",
      "publish-intelligence-agent-framework-python",
    ],
    [
      "publish-intelligence-agent-framework-python",
      "build-intelligence-agent-framework-dotnet",
    ],
    [
      "build-intelligence-agent-framework-dotnet",
      "publish-intelligence-agent-framework-dotnet",
    ],
    ["publish-intelligence-agent-framework-dotnet", "notify"],
  ])("pins %s checkout to an immutable triggering SHA", (job, nextJob) => {
    const body = workflowJob(job, nextJob);
    expect(body).not.toContain("ref: main");
    expect(body).toContain(
      "ref: ${{ github.event.workflow_run.head_sha || github.event.pull_request.merge_commit_sha || github.sha }}",
    );
  });
});
