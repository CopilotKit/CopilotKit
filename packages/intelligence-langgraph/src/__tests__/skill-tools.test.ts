import { describe, expect, it } from "vitest";
import { isLangChainTool } from "@langchain/core/tools";
import fixtures from "../../conformance/snapshots.v1.json";
import { validateSnapshot } from "@copilotkit/intelligence-delivery-core";
import type { VerifiedSnapshot } from "@copilotkit/intelligence-delivery-core";
import { createSkillTools, formatSkillCatalog } from "../skill-tools.js";

async function snapshot(name = "text-skill") {
  const fixture = fixtures.cases.find((item) => item.name === name)!;
  return validateSnapshot({
    status: "snapshot",
    bytes: new Uint8Array(Buffer.from(fixture.archiveBase64, "base64")),
    revision: fixture.revision,
    etag: fixture.etag,
    contentType: "application/zip",
  });
}

describe("skill catalog", () => {
  it("lists every skill alphabetically without eager file content", async () => {
    const source = await snapshot();
    const skills = ["zulu", "alpha", "middle"].map((name) => ({
      ...source.skills[0],
      name,
      description: `Use for ${name}.`,
    }));
    const catalog = formatSkillCatalog({ ...source, skills });
    for (const name of ["alpha", "middle", "zulu"]) {
      expect(catalog).toContain(JSON.stringify(name));
      expect(catalog).toContain(`Use for ${name}.`);
    }
    expect(catalog.indexOf('"alpha"')).toBeLessThan(
      catalog.indexOf('"middle"'),
    );
    expect(catalog.indexOf('"middle"')).toBeLessThan(catalog.indexOf('"zulu"'));
    expect(catalog).not.toContain("# Refund policy");
    expect(skills.map((skill) => skill.name)).toEqual([
      "zulu",
      "alpha",
      "middle",
    ]);
  });

  it("preserves host precedence and directs relevant skill loading", async () => {
    const catalog = formatSkillCatalog(await snapshot());
    expect(catalog).toContain("<copilotkit_learned_skills>");
    expect(catalog).toContain("</copilotkit_learned_skills>");
    expect(catalog).toMatch(/host instructions take precedence/i);
    expect(catalog).toMatch(/load relevant skills/i);
    expect(catalog).toContain("copilotkit_load_skill");
    expect(catalog).toContain("copilotkit_read_skill_file");
  });

  it("states that an empty snapshot has no available skills", async () => {
    expect(formatSkillCatalog(await snapshot("empty"))).toMatch(
      /no learned skills/i,
    );
  });
});

describe("native skill tools", () => {
  it("keeps exactly two native tools with strict named arguments when empty", async () => {
    const current = await snapshot("empty");
    const tools = createSkillTools(() => current);
    expect(tools.map((entry) => entry.name)).toEqual([
      "copilotkit_load_skill",
      "copilotkit_read_skill_file",
    ]);
    expect(tools.every(isLangChainTool)).toBe(true);
    expect(
      tools[0].schema.safeParse({ skill_name: "refund-policy" }).success,
    ).toBe(true);
    expect(tools[0].schema.safeParse({}).success).toBe(false);
    expect(
      tools[1].schema.safeParse({
        skill_name: "refund-policy",
        path: "reference.txt",
      }).success,
    ).toBe(true);
    expect(
      tools[1].schema.safeParse({ skill_name: "refund-policy" }).success,
    ).toBe(false);
  });

  it("loads the exact body and sorted supporting text names only", async () => {
    const source = await snapshot();
    const skill = source.skills[0];
    const current: VerifiedSnapshot = {
      ...source,
      skills: [
        {
          ...skill,
          files: [
            { ...skill.files[1], path: "z-last.txt" },
            { ...skill.files[1], path: "binary.bin", text: undefined },
            skill.files[0],
            { ...skill.files[1], path: "a-empty.txt", text: "" },
          ],
        },
      ],
    };
    const [load] = createSkillTools(() => current);
    const result = await load.invoke({ skill_name: "refund-policy" });
    expect(typeof result).toBe("string");
    expect(JSON.parse(result)).toEqual({
      skill_name: "refund-policy",
      content: "# Refund policy\nUse the published refund policy.\n",
      files: ["a-empty.txt", "z-last.txt"],
    });
    expect(result).not.toContain("Refunds are available");
  });

  it("reads supporting text and SKILL.md exactly", async () => {
    const current = await snapshot();
    const [, read] = createSkillTools(() => current);
    for (const file of current.skills[0].files) {
      expect(
        await read.invoke({ skill_name: "refund-policy", path: file.path }),
      ).toBe(file.text);
    }
  });

  it("preserves empty text, Unicode, BOM, and line endings", async () => {
    const source = await snapshot();
    for (const text of ["", "\ufeff€10\r\nPolicy\n"]) {
      const current = {
        ...source,
        skills: [
          {
            ...source.skills[0],
            files: [{ ...source.skills[0].files[0], text }],
          },
        ],
      };
      const [load, read] = createSkillTools(() => current);
      expect(
        JSON.parse(await load.invoke({ skill_name: "refund-policy" })).content,
      ).toBe(text);
      expect(
        await read.invoke({ skill_name: "refund-policy", path: "SKILL.md" }),
      ).toBe(text);
    }
  });

  it("consults the supplied getter on each call without replacing tools", async () => {
    let current = await snapshot();
    const [load] = createSkillTools(() => current);
    expect(
      JSON.parse(await load.invoke({ skill_name: "refund-policy" })).content,
    ).toContain("# Refund policy");
    current = await snapshot("empty");
    await expect(load.invoke({ skill_name: "refund-policy" })).rejects.toThrow(
      "Skill is unavailable.",
    );
  });

  it("waits for an asynchronous invocation snapshot before reading content", async () => {
    const [load, read] = createSkillTools(() => snapshot());
    expect(
      JSON.parse(await load.invoke({ skill_name: "refund-policy" })).content,
    ).toBe("# Refund policy\nUse the published refund policy.\n");
    expect(
      await read.invoke({ skill_name: "refund-policy", path: "reference.txt" }),
    ).toBe("Refunds are available for 30 days.\n");
  });

  it("rejects unknown skills without echoing input or content", async () => {
    const current = await snapshot();
    const [load, read] = createSkillTools(() => current);
    await expect(load.invoke({ skill_name: "secret-skill" })).rejects.toThrow(
      /^Skill is unavailable\.$/,
    );
    await expect(
      read.invoke({ skill_name: "secret-skill", path: "SKILL.md" }),
    ).rejects.toThrow(/^Skill is unavailable\.$/);
  });

  it.each([
    "unknown-secret.txt",
    "../SKILL.md",
    "/SKILL.md",
    "./SKILL.md",
    "REFERENCE.txt",
  ])("rejects nonmember path %s without echoing it", async (path) => {
    const current = await snapshot();
    const [, read] = createSkillTools(() => current);
    await expect(
      read.invoke({ skill_name: "refund-policy", path }),
    ).rejects.toThrow(/^Skill file is unavailable\.$/);
  });

  it("rejects binary resources and omits them from load results", async () => {
    const current = await snapshot("binary-resource");
    const [load, read] = createSkillTools(() => current);
    const skill_name = current.skills[0].name;
    expect(JSON.parse(await load.invoke({ skill_name })).files).not.toContain(
      "resource.bin",
    );
    await expect(
      read.invoke({ skill_name, path: "resource.bin" }),
    ).rejects.toThrow(/^Skill file is unavailable\.$/);
  });
});
