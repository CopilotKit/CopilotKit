import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type SlashCommand = {
  command?: unknown;
  description?: unknown;
  usage_hint?: unknown;
};

const manifestPath = new URL("../slack-app-manifest.yaml", import.meta.url);

async function readSlashCommands(): Promise<SlashCommand[]> {
  const manifest = parse(await readFile(manifestPath, "utf8"));
  return manifest.features.slash_commands;
}

describe("Slack app manifest", () => {
  it("defines all supported slash commands with non-empty required fields", async () => {
    const commands = await readSlashCommands();

    expect(commands).toHaveLength(4);
    expect(commands.map(({ command }) => command)).toEqual(
      expect.arrayContaining(["/agent", "/triage", "/preview", "/file-issue"]),
    );

    for (const command of commands) {
      expect(command.command).toEqual(expect.any(String));
      expect((command.command as string).trim()).not.toBe("");
      expect(command.description).toEqual(expect.any(String));
      expect((command.description as string).trim()).not.toBe("");
    }
  });

  it("never declares a blank optional usage hint", async () => {
    const commands = await readSlashCommands();

    for (const command of commands) {
      if ("usage_hint" in command) {
        expect(command.usage_hint).toEqual(expect.any(String));
        expect((command.usage_hint as string).trim()).not.toBe("");
      }
    }
  });

  it("keeps only the meaningful usage hints", async () => {
    const commands = await readSlashCommands();
    const byName = new Map(
      commands.map((command) => [command.command, command]),
    );

    expect(byName.get("/agent")?.usage_hint).toBe("<your message>");
    expect(byName.get("/preview")?.usage_hint).toBe("<issue title>");
    expect(byName.get("/triage")).not.toHaveProperty("usage_hint");
    expect(byName.get("/file-issue")).not.toHaveProperty("usage_hint");
  });
});
