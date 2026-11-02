import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitIntelligence } from "../../runtime/intelligence-platform/client";
import { SkillRegistry } from "../../runtime/intelligence-platform/skill-registry";
import type { LearnedSkillsSnapshotResult } from "../../runtime/intelligence-platform/learned-skills";
import fixtures from "../../../../intelligence-delivery-core/conformance/snapshots.v1.json";
import {
  LEARNED_SKILL_TOOL_NAMES,
  assertNoSkillToolNameConflicts,
  prepareLearnedSkills,
} from "../learned-skills";

function response(name: string): LearnedSkillsSnapshotResult {
  const fixture = fixtures.cases.find((item) => item.name === name)!;
  return {
    status: "snapshot",
    bytes: new Uint8Array(Buffer.from(fixture.archiveBase64, "base64")),
    revision: fixture.revision,
    etag: fixture.etag,
    contentType: "application/zip",
  };
}

/** Prepare one invocation's learned skills from a conformance snapshot fixture. */
async function prepareFromFixture(name = "text-skill") {
  const client = new CopilotKitIntelligence({ apiKey: "test-key" });
  vi.spyOn(client, "getLearnedSkillsSnapshot").mockResolvedValue(
    response(name),
  );
  const registry = new SkillRegistry({
    client,
    containerId: "learning",
    freshnessWindowMs: 0,
  });
  return prepareLearnedSkills(registry, new AbortController().signal);
}

async function runDefinition(name: string, args: Record<string, unknown>) {
  const { definitions } = await prepareFromFixture();
  const definition = definitions.find((spec) => spec.name === name)!;
  return definition.execute!(args);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("learned skills definitions", () => {
  it("exposes the two tools as frozen specs with their input schemas", async () => {
    const { definitions } = await prepareFromFixture();
    expect(
      definitions.map(({ name, parameters }) => [name, parameters.required]),
    ).toEqual([
      ["copilotkit_load_skill", ["skill_name"]],
      ["copilotkit_read_skill_file", ["skill_name", "path"]],
    ]);
    expect(Object.isFrozen(definitions)).toBe(true);
  });

  it("loads a skill from the invocation snapshot", async () => {
    const result = await runDefinition("copilotkit_load_skill", {
      skill_name: "refund-policy",
    });
    expect(JSON.parse(String(result))).toMatchObject({
      skill_name: "refund-policy",
      files: ["reference.txt"],
    });
  });

  it("reads an exact skill file from the invocation snapshot", async () => {
    const result = await runDefinition("copilotkit_read_skill_file", {
      skill_name: "refund-policy",
      path: "reference.txt",
    });
    expect(result).toContain("30 days");
  });

  it("rejects a non-string argument from the model", async () => {
    await expect(
      runDefinition("copilotkit_load_skill", { skill_name: 42 }),
    ).rejects.toThrow("Expected a string for skill_name.");
  });

  it("returns no definitions for an empty snapshot", async () => {
    const { definitions } = await prepareFromFixture("empty");
    expect(definitions).toEqual([]);
  });

  it("returns no definitions without a registry", async () => {
    const { definitions } = await prepareLearnedSkills(
      undefined,
      new AbortController().signal,
    );
    expect(definitions).toEqual([]);
  });
});

describe("assertNoSkillToolNameConflicts", () => {
  it("reserves the learned-skills tool names", () => {
    expect(LEARNED_SKILL_TOOL_NAMES).toEqual([
      "copilotkit_load_skill",
      "copilotkit_read_skill_file",
    ]);
  });

  it("throws for a reserved name in a list of names", () => {
    expect(() =>
      assertNoSkillToolNameConflicts(["search", "copilotkit_read_skill_file"]),
    ).toThrow(
      "Tool name is reserved for learned skills: copilotkit_read_skill_file",
    );
  });

  it("accepts names that are not reserved", () => {
    expect(() =>
      assertNoSkillToolNameConflicts(new Set(["search", "getWeather"])),
    ).not.toThrow();
  });
});
