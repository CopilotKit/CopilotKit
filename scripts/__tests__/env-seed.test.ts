import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveEnvTarget,
  discoverEnvTemplates,
  parseArgs,
  parseEnvTemplate,
  resolveTemplate,
  seedEnvFiles,
} from "../env/seed.js";

describe("env seed workflow", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "ck-env-seed-"));
    await writeFile(join(repo, ".gitignore"), ".env\n.env.local\n");
    await git(repo, ["init"]);
    await git(repo, ["config", "user.email", "env-seed@example.com"]);
    await git(repo, ["config", "user.name", "Env Seed Test"]);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("discovers broad env template names and derives target paths", async () => {
    await mkdir(join(repo, "showcase/integrations/demo"), { recursive: true });
    await mkdir(join(repo, "examples/showcases/mcp-demo"), { recursive: true });
    await writeFile(join(repo, "showcase/integrations/demo/.env.example"), "");
    await writeFile(join(repo, "showcase/.env.local.example"), "");
    await writeFile(join(repo, "examples/showcases/mcp-demo/env.example"), "");
    await writeFile(join(repo, ".env.production.example"), "");
    await writeFile(join(repo, "not-env-example.txt"), "");
    await git(repo, [
      "add",
      ".env.production.example",
      "showcase/.env.local.example",
    ]);
    await git(repo, [
      "add",
      "showcase/integrations/demo/.env.example",
      "examples/showcases/mcp-demo/env.example",
    ]);

    const templates = await discoverEnvTemplates(repo);

    expect(templates.map((template) => template.relativePath).sort()).toEqual([
      ".env.production.example",
      "examples/showcases/mcp-demo/env.example",
      "showcase/.env.local.example",
      "showcase/integrations/demo/.env.example",
    ]);
    expect(deriveEnvTarget("showcase/integrations/demo/.env.example")).toBe(
      "showcase/integrations/demo/.env",
    );
    expect(deriveEnvTarget("examples/showcases/mcp-demo/env.example")).toBe(
      "examples/showcases/mcp-demo/.env",
    );
  });

  it("discovers only tracked template files", async () => {
    await mkdir(join(repo, "tracked"), { recursive: true });
    await mkdir(join(repo, "ignored"), { recursive: true });
    await writeFile(join(repo, ".gitignore"), ".env\nignored/\n");
    await writeFile(join(repo, "tracked/.env.example"), "TRACKED=\n");
    await writeFile(join(repo, "untracked.env.example"), "UNTRACKED=\n");
    await writeFile(join(repo, "ignored/.env.example"), "IGNORED=\n");
    await git(repo, ["add", ".gitignore", "tracked/.env.example"]);

    const templates = await discoverEnvTemplates(repo);

    expect(templates.map((template) => template.relativePath)).toEqual([
      "tracked/.env.example",
    ]);
  });

  it("does not seed untracked or ignored generated templates", async () => {
    await mkdir(join(repo, "tracked"), { recursive: true });
    await mkdir(join(repo, "ignored"), { recursive: true });
    await writeFile(join(repo, ".gitignore"), ".env\nignored/\n");
    await writeFile(join(repo, "tracked/.env.example"), "TRACKED_KEY=\n");
    await writeFile(join(repo, "untracked.env.example"), "UNTRACKED_KEY=\n");
    await writeFile(join(repo, "ignored/.env.example"), "IGNORED_KEY=\n");
    await git(repo, ["add", ".gitignore", "tracked/.env.example"]);

    const result = await seedEnvFiles({
      cwd: repo,
      source: "op://Vault/Item",
      isIgnored: async () => true,
      readSecret: async (ref) => `secret-for-${ref.split("/").at(-1)}`,
    });

    expect(result.files.map((file) => file.templatePath)).toEqual([
      "tracked/.env.example",
    ]);
    expect(await readFile(join(repo, "tracked/.env"), "utf8")).toBe(
      "TRACKED_KEY=secret-for-TRACKED_KEY\n",
    );
    await expect(
      readFile(join(repo, "untracked.env"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(repo, "ignored/.env"), "utf8"),
    ).rejects.toThrow();
  });

  it("parses env templates while preserving comments and order", () => {
    const parsed = parseEnvTemplate(
      [
        "# API keys",
        "OPENAI_API_KEY=op://Engineering/CopilotKit/OPENAI_API_KEY",
        "",
        "NEXT_PUBLIC_CPK_URL=http://localhost:3000 # local app",
        "export LANGSMITH_API_KEY=",
      ].join("\n"),
    );

    expect(parsed.entries).toEqual([
      {
        key: "OPENAI_API_KEY",
        value: "op://Engineering/CopilotKit/OPENAI_API_KEY",
      },
      { key: "NEXT_PUBLIC_CPK_URL", value: "http://localhost:3000" },
      { key: "LANGSMITH_API_KEY", value: "" },
    ]);
    expect(parsed.lines.map((line) => line.raw)).toEqual([
      "# API keys",
      "OPENAI_API_KEY=op://Engineering/CopilotKit/OPENAI_API_KEY",
      "",
      "NEXT_PUBLIC_CPK_URL=http://localhost:3000 # local app",
      "export LANGSMITH_API_KEY=",
    ]);
  });

  it("merges missing values without overwriting existing non-empty local values", async () => {
    const template = [
      "# API keys",
      "OPENAI_API_KEY=op://Vault/Item/OPENAI_API_KEY",
      "ANTHROPIC_API_KEY= # optional",
      "EXISTING_KEY=op://Vault/Item/EXISTING_KEY",
    ].join("\n");
    const existing = [
      "OPENAI_API_KEY=local-value",
      "EXISTING_KEY=",
      "LOCAL_ONLY=keep-me",
    ].join("\n");

    const result = await resolveTemplate({
      template,
      existing,
      source: "op://Vault/Item",
      force: false,
      readSecret: async (ref) => `secret-for-${ref.split("/").at(-1)}`,
    });

    expect(result.content).toContain("OPENAI_API_KEY=local-value");
    expect(result.content).toContain(
      "ANTHROPIC_API_KEY=secret-for-ANTHROPIC_API_KEY # optional",
    );
    expect(result.content).toContain("EXISTING_KEY=secret-for-EXISTING_KEY");
    expect(result.content).toContain("LOCAL_ONLY=keep-me");
    expect(result.updatedKeys.sort()).toEqual([
      "ANTHROPIC_API_KEY",
      "EXISTING_KEY",
    ]);
  });

  it("serializes resolved dotenv values and preserves raw winning existing lines", async () => {
    const template = [
      "SPACE_VALUE=",
      "HASH_VALUE=",
      "QUOTE_VALUE=",
      "BACKSLASH_VALUE=",
      "INLINE_COMMENT= # keep comment",
      "QUOTED_EXISTING=",
    ].join("\n");
    const existing = [
      'QUOTED_EXISTING="local value # already quoted" # keep raw',
    ].join("\n");
    const secrets = new Map([
      ["SPACE_VALUE", "value with spaces"],
      ["HASH_VALUE", "value#with-hash"],
      ["QUOTE_VALUE", 'value with "quote"'],
      ["BACKSLASH_VALUE", "C:\\temp\\file"],
      ["INLINE_COMMENT", "resolved inline"],
    ]);

    const result = await resolveTemplate({
      template,
      existing,
      source: "op://Vault/Item",
      readSecret: async (ref) => secrets.get(ref.split("/").at(-1) ?? "") ?? "",
    });

    expect(result.content).toContain('SPACE_VALUE="value with spaces"');
    expect(result.content).toContain('HASH_VALUE="value#with-hash"');
    expect(result.content).toContain('QUOTE_VALUE="value with \\"quote\\""');
    expect(result.content).toContain('BACKSLASH_VALUE="C:\\\\temp\\\\file"');
    expect(result.content).toContain(
      'INLINE_COMMENT="resolved inline" # keep comment',
    );
    expect(result.content).toContain(
      'QUOTED_EXISTING="local value # already quoted" # keep raw',
    );
  });

  it("skips multiline resolved values instead of corrupting dotenv output", async () => {
    const result = await resolveTemplate({
      template: "MULTILINE_VALUE=\nSAFE_VALUE=\n",
      source: "op://Vault/Item",
      readSecret: async (ref) =>
        ref.endsWith("/MULTILINE_VALUE") ? "line one\nline two" : "safe value",
    });

    expect(result.content).toContain("MULTILINE_VALUE=");
    expect(result.content).toContain('SAFE_VALUE="safe value"');
    expect(result.failedKeys).toEqual(["MULTILINE_VALUE"]);
    expect(result.updatedKeys).toEqual(["SAFE_VALUE"]);
  });

  it("uses template op refs and source prefixes without logging secret values", async () => {
    const refs: string[] = [];

    const result = await resolveTemplate({
      template: [
        "FROM_TEMPLATE=op://Vault/Template/FROM_TEMPLATE",
        "FROM_SOURCE=",
        "NO_SOURCE=plain-default",
      ].join("\n"),
      source: "op://Vault/Source",
      force: true,
      readSecret: async (ref) => {
        refs.push(ref);
        return `resolved-${refs.length}`;
      },
    });

    expect(refs).toEqual([
      "op://Vault/Template/FROM_TEMPLATE",
      "op://Vault/Source/FROM_SOURCE",
      "op://Vault/Source/NO_SOURCE",
    ]);
    expect(result.skippedKeys).toEqual([]);
    expect(result.content).not.toContain("op://Vault");
  });

  it("fills requested template keys from a single dotenv source payload and ignores extras", async () => {
    await writeFile(
      join(repo, ".env.example"),
      "OPENAI_API_KEY=\nANTHROPIC_API_KEY=\n",
    );
    await git(repo, ["add", ".env.example"]);
    const refs: string[] = [];

    const result = await seedEnvFiles({
      cwd: repo,
      dotenvSource: "op://Engineering/showcase/notesPlain",
      isIgnored: async () => true,
      readSecret: async (ref) => {
        refs.push(ref);
        return [
          "OPENAI_API_KEY=openai-from-payload",
          "ANTHROPIC_API_KEY=anthropic-from-payload",
          "EXTRA_KEY=ignored",
        ].join("\n");
      },
    });

    expect(refs).toEqual(["op://Engineering/showcase/notesPlain"]);
    expect(result.files[0]).toMatchObject({
      updatedKeys: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
      skippedKeys: [],
      failedKeys: [],
    });
    expect(await readFile(join(repo, ".env"), "utf8")).toBe(
      "OPENAI_API_KEY=openai-from-payload\nANTHROPIC_API_KEY=anthropic-from-payload\n",
    );
  });

  it("uses OP_DOTENV_SOURCE and lets CLI-style dotenvSource win over the env var", async () => {
    await writeFile(join(repo, ".env.example"), "OPENAI_API_KEY=\n");
    await git(repo, ["add", ".env.example"]);
    const originalSource = process.env.OP_DOTENV_SOURCE;
    process.env.OP_DOTENV_SOURCE = "op://Engineering/showcase/env";
    const refs: string[] = [];

    try {
      const envResult = await seedEnvFiles({
        cwd: repo,
        isIgnored: async () => true,
        readSecret: async (ref) => {
          refs.push(ref);
          return "OPENAI_API_KEY=from-env-source";
        },
      });
      expect(envResult.files[0].updatedKeys).toEqual(["OPENAI_API_KEY"]);

      const cliResult = await seedEnvFiles({
        cwd: repo,
        force: true,
        dotenvSource: "op://Engineering/showcase/notesPlain",
        isIgnored: async () => true,
        readSecret: async (ref) => {
          refs.push(ref);
          return "OPENAI_API_KEY=from-cli-source";
        },
      });

      expect(refs).toEqual([
        "op://Engineering/showcase/env",
        "op://Engineering/showcase/notesPlain",
      ]);
      expect(cliResult.files[0].updatedKeys).toEqual(["OPENAI_API_KEY"]);
      expect(await readFile(join(repo, ".env"), "utf8")).toBe(
        "OPENAI_API_KEY=from-cli-source\n",
      );
    } finally {
      if (originalSource === undefined) delete process.env.OP_DOTENV_SOURCE;
      else process.env.OP_DOTENV_SOURCE = originalSource;
    }
  });

  it("uses the repo-wide 1Password Secure Note as the default dotenv source", async () => {
    await writeFile(join(repo, ".env.example"), "OPENAI_API_KEY=\n");
    await git(repo, ["add", ".env.example"]);
    const originalSource = process.env.OP_DOTENV_SOURCE;
    delete process.env.OP_DOTENV_SOURCE;
    const refs: string[] = [];

    try {
      const result = await seedEnvFiles({
        cwd: repo,
        isIgnored: async () => true,
        readSecret: async (ref) => {
          refs.push(ref);
          return "OPENAI_API_KEY=from-default-source";
        },
      });

      expect(refs).toEqual(["op://Engineering/CopilotKit/notesPlain"]);
      expect(result.files[0].updatedKeys).toEqual(["OPENAI_API_KEY"]);
      expect(await readFile(join(repo, ".env"), "utf8")).toBe(
        "OPENAI_API_KEY=from-default-source\n",
      );
    } finally {
      if (originalSource === undefined) delete process.env.OP_DOTENV_SOURCE;
      else process.env.OP_DOTENV_SOURCE = originalSource;
    }
  });

  it("prefers CLI dotenvSource over OP_DOTENV_SOURCE over the default dotenv source", async () => {
    await writeFile(join(repo, ".env.example"), "OPENAI_API_KEY=\n");
    await git(repo, ["add", ".env.example"]);
    const originalSource = process.env.OP_DOTENV_SOURCE;
    process.env.OP_DOTENV_SOURCE = "op://Engineering/EnvOverride/notesPlain";
    const refs: string[] = [];

    try {
      const envResult = await seedEnvFiles({
        cwd: repo,
        isIgnored: async () => true,
        readSecret: async (ref) => {
          refs.push(ref);
          return "OPENAI_API_KEY=from-env-source";
        },
      });
      expect(envResult.files[0].updatedKeys).toEqual(["OPENAI_API_KEY"]);

      const cliResult = await seedEnvFiles({
        cwd: repo,
        force: true,
        dotenvSource: "op://Engineering/CliOverride/notesPlain",
        isIgnored: async () => true,
        readSecret: async (ref) => {
          refs.push(ref);
          return "OPENAI_API_KEY=from-cli-source";
        },
      });

      expect(refs).toEqual([
        "op://Engineering/EnvOverride/notesPlain",
        "op://Engineering/CliOverride/notesPlain",
      ]);
      expect(cliResult.files[0].updatedKeys).toEqual(["OPENAI_API_KEY"]);
      expect(await readFile(join(repo, ".env"), "utf8")).toBe(
        "OPENAI_API_KEY=from-cli-source\n",
      );
    } finally {
      if (originalSource === undefined) delete process.env.OP_DOTENV_SOURCE;
      else process.env.OP_DOTENV_SOURCE = originalSource;
    }
  });

  it("parses dotenv source CLI arguments", () => {
    expect(
      parseArgs(["--dotenv-source", "op://Engineering/showcase/notesPlain"]),
    ).toMatchObject({
      dotenvSource: "op://Engineering/showcase/notesPlain",
      force: false,
      strict: false,
    });

    expect(
      parseArgs(["--dotenv-source=op://Engineering/showcase/.env"]),
    ).toMatchObject({
      dotenvSource: "op://Engineering/showcase/.env",
      force: false,
      strict: false,
    });
  });

  it("keeps existing parser behavior for missing dotenv source CLI values", () => {
    expect(parseArgs(["--dotenv-source"])).toEqual({
      dotenvSource: undefined,
      force: false,
      strict: false,
    });
  });

  it("falls back to field source when a requested key is missing from dotenv source", async () => {
    await writeFile(
      join(repo, ".env.example"),
      "OPENAI_API_KEY=\nANTHROPIC_API_KEY=\n",
    );
    await git(repo, ["add", ".env.example"]);
    const refs: string[] = [];
    const logs: string[] = [];

    const result = await seedEnvFiles({
      cwd: repo,
      dotenvSource: "op://Engineering/showcase/notesPlain",
      source: "op://Engineering/showcase",
      isIgnored: async () => true,
      log: (message) => logs.push(message),
      readSecret: async (ref) => {
        refs.push(ref);
        if (ref === "op://Engineering/showcase/notesPlain") {
          return "OPENAI_API_KEY=openai-from-payload";
        }
        return `field-${ref.split("/").at(-1)}`;
      },
    });

    expect(refs).toEqual([
      "op://Engineering/showcase/notesPlain",
      "op://Engineering/showcase/ANTHROPIC_API_KEY",
    ]);
    expect(result.files[0]).toMatchObject({
      updatedKeys: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
    });
    expect(await readFile(join(repo, ".env"), "utf8")).toBe(
      "OPENAI_API_KEY=openai-from-payload\nANTHROPIC_API_KEY=field-ANTHROPIC_API_KEY\n",
    );
    expect(logs.join("\n")).toContain(
      "env:seed warn .env:ANTHROPIC_API_KEY: not found in dotenv source",
    );
    expect(logs.join("\n")).not.toContain("openai-from-payload");
  });

  it("skips missing dotenv source keys without crashing when no fallback source is configured", async () => {
    await writeFile(
      join(repo, ".env.example"),
      "OPENAI_API_KEY=\nANTHROPIC_API_KEY=\n",
    );
    await git(repo, ["add", ".env.example"]);

    const result = await seedEnvFiles({
      cwd: repo,
      dotenvSource: "op://Engineering/showcase/notesPlain",
      isIgnored: async () => true,
      readSecret: async () => "OPENAI_API_KEY=openai-from-payload",
    });

    expect(result.exitCode).toBe(0);
    expect(result.files[0]).toMatchObject({
      updatedKeys: ["OPENAI_API_KEY"],
      skippedKeys: ["ANTHROPIC_API_KEY"],
    });
    expect(await readFile(join(repo, ".env"), "utf8")).toBe(
      "OPENAI_API_KEY=openai-from-payload\nANTHROPIC_API_KEY=\n",
    );
  });

  it("does not crash on dotenv source read failure unless strict mode is enabled", async () => {
    await writeFile(join(repo, ".env.example"), "OPENAI_API_KEY=\n");
    await git(repo, ["add", ".env.example"]);
    const logs: string[] = [];

    const result = await seedEnvFiles({
      cwd: repo,
      dotenvSource: "op://Engineering/showcase/notesPlain",
      strict: false,
      isIgnored: async () => true,
      log: (message) => logs.push(message),
      readSecret: async () => {
        throw new Error("op is not available");
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.files[0]).toMatchObject({
      skippedKeys: ["OPENAI_API_KEY"],
      failedKeys: [],
    });
    expect(logs.join("\n")).toContain(
      "env:seed warn dotenv source op://Engineering/showcase/notesPlain: unable to read",
    );

    const strictResult = await seedEnvFiles({
      cwd: repo,
      dotenvSource: "op://Engineering/showcase/notesPlain",
      strict: true,
      isIgnored: async () => true,
      readSecret: async () => {
        throw new Error("op is not available");
      },
    });

    expect(strictResult.exitCode).toBe(1);
  });

  it("warns and continues when the default dotenv source is unavailable unless strict mode is enabled", async () => {
    await writeFile(join(repo, ".env.example"), "OPENAI_API_KEY=\n");
    await git(repo, ["add", ".env.example"]);
    const originalSource = process.env.OP_DOTENV_SOURCE;
    delete process.env.OP_DOTENV_SOURCE;
    const logs: string[] = [];

    try {
      const result = await seedEnvFiles({
        cwd: repo,
        strict: false,
        isIgnored: async () => true,
        log: (message) => logs.push(message),
        readSecret: async () => {
          throw new Error("op is not available");
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.files[0]).toMatchObject({
        skippedKeys: ["OPENAI_API_KEY"],
        failedKeys: [],
      });
      expect(logs.join("\n")).toContain(
        "env:seed warn dotenv source op://Engineering/CopilotKit/notesPlain: unable to read",
      );

      const strictResult = await seedEnvFiles({
        cwd: repo,
        strict: true,
        isIgnored: async () => true,
        readSecret: async () => {
          throw new Error("op is not available");
        },
      });

      expect(strictResult.exitCode).toBe(1);
    } finally {
      if (originalSource === undefined) delete process.env.OP_DOTENV_SOURCE;
      else process.env.OP_DOTENV_SOURCE = originalSource;
    }
  });

  it("keeps explicit template op refs ahead of dotenv source values", async () => {
    const refs: string[] = [];

    const result = await resolveTemplate({
      template: "OPENAI_API_KEY=op://Vault/Direct/OPENAI_API_KEY\n",
      dotenvValues: new Map([["OPENAI_API_KEY", "from-payload"]]),
      readSecret: async (ref) => {
        refs.push(ref);
        return "from-direct-ref";
      },
    });

    expect(refs).toEqual(["op://Vault/Direct/OPENAI_API_KEY"]);
    expect(result.content).toBe("OPENAI_API_KEY=from-direct-ref\n");
  });

  it("keeps existing non-empty values unless force allows dotenv source replacement", async () => {
    const template = "OPENAI_API_KEY=\n";
    const existing = "OPENAI_API_KEY=local-value\n";

    const preserved = await resolveTemplate({
      template,
      existing,
      dotenvValues: new Map([["OPENAI_API_KEY", "from-payload"]]),
      readSecret: async () => {
        throw new Error("should not read");
      },
    });
    expect(preserved.content).toBe("OPENAI_API_KEY=local-value\n");
    expect(preserved.updatedKeys).toEqual([]);

    const forced = await resolveTemplate({
      template,
      existing,
      force: true,
      dotenvValues: new Map([["OPENAI_API_KEY", "from-payload"]]),
      readSecret: async () => {
        throw new Error("should not read");
      },
    });
    expect(forced.content).toBe("OPENAI_API_KEY=from-payload\n");
    expect(forced.updatedKeys).toEqual(["OPENAI_API_KEY"]);
  });

  it("reports malformed dotenv source lines without leaking values", async () => {
    await writeFile(join(repo, ".env.example"), "OPENAI_API_KEY=\n");
    await git(repo, ["add", ".env.example"]);
    const logs: string[] = [];

    const result = await seedEnvFiles({
      cwd: repo,
      dotenvSource: "op://Engineering/showcase/notesPlain",
      isIgnored: async () => true,
      log: (message) => logs.push(message),
      readSecret: async () =>
        ["OPENAI_API_KEY=openai-from-payload", "malformed-secret-line"].join(
          "\n",
        ),
    });

    expect(result.exitCode).toBe(0);
    expect(logs.join("\n")).toContain(
      "env:seed warn dotenv source op://Engineering/showcase/notesPlain: malformed line(s): 2",
    );
    expect(logs.join("\n")).not.toContain("malformed-secret-line");

    const strictResult = await seedEnvFiles({
      cwd: repo,
      dotenvSource: "op://Engineering/showcase/notesPlain",
      strict: true,
      isIgnored: async () => true,
      readSecret: async () =>
        ["OPENAI_API_KEY=openai-from-payload", "malformed-secret-line"].join(
          "\n",
        ),
    });
    expect(strictResult.exitCode).toBe(1);
  });

  it("rejects multiline dotenv source values instead of writing partial values", async () => {
    await writeFile(join(repo, ".env.example"), "OPENAI_API_KEY=\n");
    await git(repo, ["add", ".env.example"]);
    const logs: string[] = [];

    const result = await seedEnvFiles({
      cwd: repo,
      dotenvSource: "op://Engineering/showcase/notesPlain",
      isIgnored: async () => true,
      log: (message) => logs.push(message),
      readSecret: async () =>
        ['OPENAI_API_KEY="line one', 'line two"'].join("\n"),
    });

    expect(result.files[0]).toMatchObject({
      updatedKeys: [],
      skippedKeys: ["OPENAI_API_KEY"],
    });
    expect(await readFile(join(repo, ".env"), "utf8")).toBe(
      "OPENAI_API_KEY=\n",
    );
    expect(logs.join("\n")).toContain("malformed line(s): 1, 2");
    expect(logs.join("\n")).not.toContain("line one");
    expect(logs.join("\n")).not.toContain("line two");
  });

  it("continues when op reads fail and when targets are not gitignored", async () => {
    await writeFile(join(repo, ".env.example"), "OPENAI_API_KEY=\n");
    await git(repo, ["add", ".env.example"]);

    const result = await seedEnvFiles({
      cwd: repo,
      source: "op://Vault/Item",
      force: false,
      strict: false,
      isIgnored: async () => false,
      readSecret: async () => {
        throw new Error("op is not available");
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.files).toEqual([
      expect.objectContaining({
        targetPath: ".env",
        skipped: true,
        reason: "not_gitignored",
      }),
    ]);
  });

  it("does not crash on op read failures unless strict mode is enabled", async () => {
    await writeFile(join(repo, ".env.example"), "OPENAI_API_KEY=\n");
    await git(repo, ["add", ".env.example"]);

    const result = await seedEnvFiles({
      cwd: repo,
      source: "op://Vault/Item",
      strict: false,
      isIgnored: async () => true,
      readSecret: async () => {
        throw new Error("op is not available");
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.files[0]).toMatchObject({
      targetPath: ".env",
      failedKeys: ["OPENAI_API_KEY"],
    });
    expect(await readFile(join(repo, ".env"), "utf8")).toBe(
      "OPENAI_API_KEY=\n",
    );

    const strictResult = await seedEnvFiles({
      cwd: repo,
      source: "op://Vault/Item",
      strict: true,
      isIgnored: async () => true,
      readSecret: async () => {
        throw new Error("op is not available");
      },
    });

    expect(strictResult.exitCode).toBe(1);
  });
});

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("GIT_")) delete env[key];
    }
    execFile("git", args, { cwd, env }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
