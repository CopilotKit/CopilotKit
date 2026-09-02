import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readFixture = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("README prerequisites", () => {
  it("requires pnpm for workspace dependencies", () => {
    const readme = readFixture("./README.md");
    const packageJson = JSON.parse(readFixture("./package.json")) as {
      dependencies: Record<string, string>;
    };

    expect(Object.values(packageJson.dependencies)).toContain("workspace:*");
    expect(readme).toContain("- pnpm");
    expect(readme).not.toContain("npm, yarn, or pnpm");
    expect(readme).not.toContain("Using other package managers");
    expect(readme).not.toMatch(/\b(?:npm|yarn) (?:install|run dev|dev)/);
  });

  it("stores local agent API keys in the agent working directory", () => {
    const readme = readFixture("./README.md");
    const packageJson = JSON.parse(readFixture("./package.json")) as {
      scripts: { "dev:agent": string };
    };
    const agentDirectory =
      packageJson.scripts["dev:agent"].match(/^cd ([^ ]+) &&/)?.[1];

    expect(agentDirectory).toBeDefined();
    expect(readme).toContain(`Create \`${agentDirectory}/.env\``);
  });

  it("stores the Copilot Cloud public key in the Next.js project root", () => {
    const readme = readFixture("./README.md");

    expect(readme).toContain(
      "Create `.env.local` in the example root:\n\n   ```\n   NEXT_PUBLIC_CPK_PUBLIC_API_KEY=your_copilotkit_api_key",
    );
  });

  it("starts only the frontend when using Copilot Cloud", () => {
    const readme = readFixture("./README.md");
    const packageJson = JSON.parse(readFixture("./package.json")) as {
      scripts: { dev: string; "dev:ui": string };
    };

    expect(packageJson.scripts.dev).toContain("npm run dev:agent");
    expect(packageJson.scripts["dev:ui"]).toBe("next dev");
    expect(readme).toContain(
      "When using Copilot Cloud, start only the frontend:\n\n   ```bash\n   pnpm dev:ui\n   ```",
    );
  });

  it("matches the Python version required by the agent lockfile", () => {
    const readme = readFixture("./README.md");
    const lockfile = readFixture("./agent/uv.lock");
    const readmeVersion = readme.match(/Python (\d+\.\d+)\+/)?.[1];
    const lockfileVersion = lockfile.match(
      /requires-python = ">=(\d+\.\d+)"/,
    )?.[1];

    expect(readmeVersion).toBeDefined();
    expect(lockfileVersion).toBeDefined();
    expect(readmeVersion).toBe(lockfileVersion);
  });
});
