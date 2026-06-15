import { describe, it, expect, vi } from "vitest";
import { jsonSchemaToDiscordOptions, buildCommandBody, registerCommands } from "./commands.js";
import type { CommandSpec } from "@copilotkit/bot";

describe("jsonSchemaToDiscordOptions", () => {
  it("maps primitive properties to typed options with required flags", () => {
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: {
        priority: { type: "string", enum: ["low", "high"], description: "How urgent" },
        count: { type: "integer" },
        notify: { type: "boolean" },
      },
      required: ["priority"],
    });
    // String option type = 3, Integer = 4, Boolean = 5 (Discord ApplicationCommandOptionType).
    const priority = opts.find((o) => o.name === "priority")!;
    expect(priority.type).toBe(3);
    expect(priority.required).toBe(true);
    expect(priority.choices).toEqual([
      { name: "low", value: "low" },
      { name: "high", value: "high" },
    ]);
    expect(opts.find((o) => o.name === "count")!.type).toBe(4);
    expect(opts.find((o) => o.name === "notify")!.type).toBe(5);
    expect(opts.find((o) => o.name === "count")!.required).toBe(false);
  });

  it("degrades an unsupported (nested object) property to a free-text string option", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { meta: { type: "object" } },
    });
    expect(opts[0]).toMatchObject({ name: "meta", type: 3 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns [] for a free-text command (no options schema)", () => {
    expect(jsonSchemaToDiscordOptions(undefined)).toEqual([]);
  });
});

describe("registerCommands", () => {
  const spec: CommandSpec = { name: "triage", description: "Triage the thread", options: undefined };

  it("registers to a guild when guildId is set", async () => {
    const put = vi.fn(async (_route: `/${string}`, _opts: { body: unknown }) => {});
    await registerCommands({ put } as any, "app-1", "guild-9", [spec]);
    expect(put).toHaveBeenCalledTimes(1);
    const [route, body] = put.mock.calls[0]!;
    expect(String(route)).toContain("guild-9");
    expect((body as any).body[0]).toMatchObject({ name: "triage", description: "Triage the thread" });
  });

  it("registers globally when guildId is absent", async () => {
    const put = vi.fn(async (_route: `/${string}`, _opts: { body: unknown }) => {});
    await registerCommands({ put } as any, "app-1", undefined, [spec]);
    const [route] = put.mock.calls[0]!;
    expect(String(route)).not.toContain("guild");
    expect(String(route)).toContain("app-1");
  });
});
