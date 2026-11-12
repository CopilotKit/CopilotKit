import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type SlashCommand = {
  command?: unknown;
  description?: unknown;
  usage_hint?: unknown;
};

type ManifestSource = {
  name: string;
  path: URL;
  parse: (source: string) => unknown;
};

const manifestSources: ManifestSource[] = [
  {
    name: "YAML",
    path: new URL("../slack-app-manifest.yaml", import.meta.url),
    parse,
  },
  {
    name: "JSON",
    path: new URL("../slack-app-manifest.json", import.meta.url),
    parse: JSON.parse,
  },
];

async function readSlashCommands({
  name,
  path,
  parse: parseManifest,
}: ManifestSource): Promise<SlashCommand[]> {
  const manifest = parseManifest(await readFile(path, "utf8")) as {
    features?: { slash_commands?: SlashCommand[] };
  };
  const commands = manifest.features?.slash_commands;

  if (!Array.isArray(commands)) {
    throw new Error(`${name} manifest is missing features.slash_commands`);
  }

  return commands;
}

describe.each(manifestSources)("$name Slack app manifest", (manifestSource) => {
  it("defines all supported slash commands with non-empty required fields", async () => {
    const commands = await readSlashCommands(manifestSource);

    expect(commands).toHaveLength(8);
    expect(commands.map(({ command }) => command)).toEqual(
      expect.arrayContaining([
        "/agent",
        "/triage",
        "/preview",
        "/file-issue",
        "/prs",
        "/pulse",
        "/standup",
        "/carousel",
      ]),
    );

    for (const command of commands) {
      expect(command.command).toEqual(expect.any(String));
      expect((command.command as string).trim()).not.toBe("");
      expect(command.description).toEqual(expect.any(String));
      expect((command.description as string).trim()).not.toBe("");
    }
  });

  it("never declares a blank optional usage hint", async () => {
    const commands = await readSlashCommands(manifestSource);

    for (const command of commands) {
      if ("usage_hint" in command) {
        expect(command.usage_hint).toEqual(expect.any(String));
        expect((command.usage_hint as string).trim()).not.toBe("");
      }
    }
  });

  it("keeps only the meaningful usage hints", async () => {
    const commands = await readSlashCommands(manifestSource);
    const byName = new Map(
      commands.map((command) => [command.command, command]),
    );

    expect(byName.get("/agent")?.usage_hint).toBe("<your message>");
    expect(byName.get("/preview")?.usage_hint).toBe("<issue title>");
    expect(byName.get("/triage")).not.toHaveProperty("usage_hint");
    expect(byName.get("/file-issue")).not.toHaveProperty("usage_hint");
    expect(byName.get("/prs")).not.toHaveProperty("usage_hint");
    expect(byName.get("/pulse")).not.toHaveProperty("usage_hint");
    expect(byName.get("/standup")).not.toHaveProperty("usage_hint");
    expect(byName.get("/carousel")).not.toHaveProperty("usage_hint");
  });
});

it("keeps the YAML and JSON slash commands in sync", async () => {
  const [yamlCommands, jsonCommands] = await Promise.all(
    manifestSources.map(readSlashCommands),
  );

  expect(jsonCommands).toEqual(yamlCommands);
});
