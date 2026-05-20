import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  syncPluginSkills,
  RESERVED_LIFECYCLE_SLUGS,
} from "../sync-plugin-skills.js";

// Fixture helper — builds a miniature repo layout inside a tmpdir that mimics
// the CopilotKit monorepo shape.
async function makeRepo(root: string) {
  const pkgRoot = join(root, "packages");
  // Two package meta-skills — deliberately different shapes to exercise
  // the recursive-copy path and the single-file path.
  await mkdir(join(pkgRoot, "runtime/skills/runtime/references"), {
    recursive: true,
  });
  await writeFile(
    join(pkgRoot, "runtime/skills/runtime/SKILL.md"),
    "---\nname: runtime\n---\n# Runtime\n",
  );
  await writeFile(
    join(pkgRoot, "runtime/skills/runtime/references/setup-endpoint.md"),
    "# Setup\n",
  );
  await mkdir(join(pkgRoot, "a2ui-renderer/skills/a2ui-renderer"), {
    recursive: true,
  });
  await writeFile(
    join(pkgRoot, "a2ui-renderer/skills/a2ui-renderer/SKILL.md"),
    "---\nname: a2ui-renderer\n---\n# A2UI\n",
  );
  // Pre-existing lifecycle skill at the mirror root — must be left alone.
  await mkdir(join(root, "skills/0-to-working-chat"), { recursive: true });
  await writeFile(
    join(root, "skills/0-to-working-chat/SKILL.md"),
    "---\nname: 0-to-working-chat\n---\n# Lifecycle\n",
  );
}

describe("syncPluginSkills", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "ck-plugin-sync-"));
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("copies package skill SKILL.md and references into the mirror", async () => {
    await makeRepo(repo);
    const result = await syncPluginSkills({ cwd: repo, mode: "write" });
    expect(result.exitCode).toBe(0);

    const runtimeSkill = await readFile(
      join(repo, "skills/runtime/SKILL.md"),
      "utf8",
    );
    expect(runtimeSkill).toBe("---\nname: runtime\n---\n# Runtime\n");

    const runtimeRef = await readFile(
      join(repo, "skills/runtime/references/setup-endpoint.md"),
      "utf8",
    );
    expect(runtimeRef).toBe("# Setup\n");

    const a2uiSkill = await readFile(
      join(repo, "skills/a2ui-renderer/SKILL.md"),
      "utf8",
    );
    expect(a2uiSkill).toBe("---\nname: a2ui-renderer\n---\n# A2UI\n");
  });

  it("does not modify pre-existing lifecycle skills", async () => {
    await makeRepo(repo);
    await syncPluginSkills({ cwd: repo, mode: "write" });
    const lifecycle = await readFile(
      join(repo, "skills/0-to-working-chat/SKILL.md"),
      "utf8",
    );
    expect(lifecycle).toBe("---\nname: 0-to-working-chat\n---\n# Lifecycle\n");
  });

  it("errors with exit code 2 if a package skill collides with a reserved lifecycle slug", async () => {
    const pkgRoot = join(repo, "packages");
    await mkdir(join(pkgRoot, "rogue/skills/0-to-working-chat"), {
      recursive: true,
    });
    await writeFile(
      join(pkgRoot, "rogue/skills/0-to-working-chat/SKILL.md"),
      "collision\n",
    );
    const result = await syncPluginSkills({ cwd: repo, mode: "write" });
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/collides with reserved lifecycle slug/);
  });

  it("check mode returns exitCode 0 when mirror is in sync", async () => {
    await makeRepo(repo);
    await syncPluginSkills({ cwd: repo, mode: "write" });
    const result = await syncPluginSkills({ cwd: repo, mode: "check" });
    expect(result.exitCode).toBe(0);
  });

  it("check mode returns exitCode 1 when mirror has drifted", async () => {
    await makeRepo(repo);
    await syncPluginSkills({ cwd: repo, mode: "write" });
    // Simulate a maintainer editing the package source without re-running sync.
    await writeFile(
      join(repo, "packages/runtime/skills/runtime/SKILL.md"),
      "---\nname: runtime\n---\n# Runtime (edited)\n",
    );
    const result = await syncPluginSkills({ cwd: repo, mode: "check" });
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/drift detected/i);
    expect(result.message).toContain("skills/runtime/SKILL.md");
  });

  it("check mode flags orphan files in the mirror (e.g., skill deleted from source)", async () => {
    await makeRepo(repo);
    await syncPluginSkills({ cwd: repo, mode: "write" });
    await rm(join(repo, "packages/a2ui-renderer"), { recursive: true });
    const result = await syncPluginSkills({ cwd: repo, mode: "check" });
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/orphan/i);
    expect(result.message).toContain("skills/a2ui-renderer");
  });

  it("exports the reserved lifecycle slug set", () => {
    expect(RESERVED_LIFECYCLE_SLUGS).toContain("0-to-working-chat");
    expect(RESERVED_LIFECYCLE_SLUGS).toContain("v1-to-v2-migration");
    expect(RESERVED_LIFECYCLE_SLUGS.size).toBe(6);
  });

  // Version sync — the plugin version tracks packages/runtime/package.json.

  async function addVersionFixtures(
    repoRoot: string,
    runtimePkgVersion: string,
    initialPluginVersion: string,
  ) {
    await writeFile(
      join(repoRoot, "packages/runtime/package.json"),
      JSON.stringify(
        { name: "@copilotkit/runtime", version: runtimePkgVersion },
        null,
        2,
      ) + "\n",
    );
    await mkdir(join(repoRoot, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(repoRoot, ".claude-plugin/plugin.json"),
      JSON.stringify(
        { name: "copilotkit", version: initialPluginVersion },
        null,
        2,
      ) + "\n",
    );
    await writeFile(
      join(repoRoot, ".claude-plugin/marketplace.json"),
      JSON.stringify(
        {
          name: "copilotkit",
          plugins: [
            { name: "copilotkit", source: "./", version: initialPluginVersion },
          ],
        },
        null,
        2,
      ) + "\n",
    );
  }

  it("write mode copies runtime package.json version into plugin.json and marketplace.json", async () => {
    await makeRepo(repo);
    await addVersionFixtures(repo, "1.56.2", "0.0.0");
    await syncPluginSkills({ cwd: repo, mode: "write" });
    const plugin = JSON.parse(
      await readFile(join(repo, ".claude-plugin/plugin.json"), "utf8"),
    );
    const market = JSON.parse(
      await readFile(join(repo, ".claude-plugin/marketplace.json"), "utf8"),
    );
    expect(plugin.version).toBe("1.56.2");
    expect(market.plugins[0].version).toBe("1.56.2");
  });

  it("check mode detects plugin.json version drift", async () => {
    await makeRepo(repo);
    await addVersionFixtures(repo, "1.56.2", "0.0.0");
    await syncPluginSkills({ cwd: repo, mode: "write" });
    // Simulate a maintainer bumping the package but forgetting to run sync.
    await writeFile(
      join(repo, "packages/runtime/package.json"),
      JSON.stringify(
        { name: "@copilotkit/runtime", version: "1.57.0" },
        null,
        2,
      ) + "\n",
    );
    const result = await syncPluginSkills({ cwd: repo, mode: "check" });
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/version.*drift/i);
    expect(result.message).toContain("1.57.0");
  });
});
