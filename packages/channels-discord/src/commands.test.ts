import { describe, it, expect, vi } from "vitest";
import {
  jsonSchemaToDiscordOptions,
  buildCommandBody,
  registerCommands,
} from "./commands.js";
import type { CommandSpec } from "@copilotkit/channels";

describe("jsonSchemaToDiscordOptions", () => {
  it("maps primitive properties to typed options with required flags", () => {
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: {
        priority: {
          type: "string",
          enum: ["low", "high"],
          description: "How urgent",
        },
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

  it("orders required options before optional ones (Discord requirement)", () => {
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: {
        note: { type: "string" },
        priority: { type: "string" },
      },
      required: ["priority"],
    });
    // `note` is declared first but is optional; `priority` must come first.
    expect(opts.map((o) => o.name)).toEqual(["priority", "note"]);
    expect(opts[0]!.required).toBe(true);
    expect(opts[1]!.required).toBe(false);
  });

  it("builds numeric choices for an integer enum", () => {
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { level: { type: "integer", enum: [1, 2, 3] } },
    });
    const level = opts.find((o) => o.name === "level")!;
    expect(level.type).toBe(4);
    expect(level.choices).toEqual([
      { name: "1", value: 1 },
      { name: "2", value: 2 },
      { name: "3", value: 3 },
    ]);
  });

  it("skips non-numeric enum entries for an integer option (NaN would reject the batch)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { level: { type: "integer", enum: [1, "x", 3] } },
    });
    const level = opts.find((o) => o.name === "level")!;
    expect(level.type).toBe(4);
    // "x" → NaN → dropped; only finite values survive.
    expect(level.choices).toEqual([
      { name: "1", value: 1 },
      { name: "3", value: 3 },
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("normalizes a nullable array type (['string','null']) to a String option, not the warn path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { note: { type: ["string", "null"] } },
    });
    const note = opts.find((o) => o.name === "note")!;
    expect(note.type).toBe(3); // String, not the default-warn fallthrough
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("omits the choices key (not []) when an integer enum has no numeric entries", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { level: { type: "integer", enum: ["a", "b", "c"] } },
    });
    const level = opts.find((o) => o.name === "level")!;
    expect(level.type).toBe(4);
    // No choices key at all — an empty `choices: []` would make Discord reject the batch.
    expect("choices" in level).toBe(false);
    expect(level.choices).toBeUndefined();
    warn.mockRestore();
  });

  it("drops non-integer values from an integer enum (1.5 is not an integer)", () => {
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { level: { type: "integer", enum: [1, 1.5, 2] } },
    });
    const level = opts.find((o) => o.name === "level")!;
    expect(level.choices).toEqual([
      { name: "1", value: 1 },
      { name: "2", value: 2 },
    ]);
  });

  it("keeps non-integer finite values for a number (float) enum", () => {
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { ratio: { type: "number", enum: [1, 1.5, 2] } },
    });
    const ratio = opts.find((o) => o.name === "ratio")!;
    expect(ratio.type).toBe(10);
    expect(ratio.choices).toEqual([
      { name: "1", value: 1 },
      { name: "1.5", value: 1.5 },
      { name: "2", value: 2 },
    ]);
  });

  it("skips an empty-name choice (String('') is whitespace, Number('') is a finite 0)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const intOpts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { level: { type: "integer", enum: ["", 1] } },
    });
    expect(intOpts.find((o) => o.name === "level")!.choices).toEqual([
      { name: "1", value: 1 },
    ]);

    const strOpts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { tag: { type: "string", enum: ["", " ", "ok"] } },
    });
    expect(strOpts.find((o) => o.name === "tag")!.choices).toEqual([
      { name: "ok", value: "ok" },
    ]);
    warn.mockRestore();
  });

  it("clamps an enum with more than 25 values to exactly 25 choices", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const thirty = Array.from({ length: 30 }, (_, i) => i + 1);
    const intOpts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { level: { type: "integer", enum: thirty } },
    });
    expect(intOpts.find((o) => o.name === "level")!.choices!.length).toBe(25);

    const strOpts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { tag: { type: "string", enum: thirty.map((n) => `v${n}`) } },
    });
    expect(strOpts.find((o) => o.name === "tag")!.choices!.length).toBe(25);
    warn.mockRestore();
  });

  it("clamps a command to at most 25 options", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) properties[`opt${i}`] = { type: "string" };
    const opts = jsonSchemaToDiscordOptions({ type: "object", properties });
    expect(opts.length).toBe(25);
    warn.mockRestore();
  });

  it("normalizes an option name to a lowercase valid slug (<=32, matches ^[-_a-z0-9]+$)", () => {
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { "My Opt Name!": { type: "string" } },
    });
    const name = opts[0]!.name;
    expect(name).toMatch(/^[-_a-z0-9]+$/);
    expect(name.length).toBeGreaterThanOrEqual(1);
    expect(name.length).toBeLessThanOrEqual(32);
  });

  it("skips a string choice whose value exceeds 100 chars (a truncated value would fail enum validation), but keeps a <=100-char member with its exact value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const long = "z".repeat(120);
    const short = "z".repeat(100);
    const strOpts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { tag: { type: "string", enum: [long, short, "ok"] } },
    });
    const choices = strOpts.find((o) => o.name === "tag")!.choices!;
    // The >100-char member is dropped entirely — NOT emitted with a truncated value.
    expect(
      choices.some(
        (c) => String(c.value).endsWith("…") || String(c.value).length > 100,
      ),
    ).toBe(false);
    expect(choices.some((c) => c.value === long)).toBe(false);
    // The <=100-char members survive with their exact (round-trippable) value.
    expect(choices).toContainEqual({ name: short, value: short });
    expect(choices).toContainEqual({ name: "ok", value: "ok" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("truncates a long choice name (display-only) while keeping the value exact when <=100 chars", () => {
    // A value of exactly 100 chars is kept verbatim; the name is display-only and may be truncated,
    // but at 100 chars it is already within the name cap so it too stays intact.
    const value = "v".repeat(100);
    const strOpts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { tag: { type: "string", enum: [value] } },
    });
    const choice = strOpts.find((o) => o.name === "tag")!.choices![0]!;
    expect(choice.value).toBe(value);
    expect(String(choice.value).length).toBe(100);
    expect(choice.name.length).toBeLessThanOrEqual(100);

    const intOpts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: {
        level: { type: "integer", enum: [Number("1".repeat(120))] },
      },
    });
    // A 120-digit number → Infinity (not finite/integer) → dropped, so just assert no crash.
    expect(intOpts.find((o) => o.name === "level")).toBeTruthy();
  });

  it("truncates an option description longer than 100 chars", () => {
    const long = "x".repeat(250);
    const opts = jsonSchemaToDiscordOptions({
      type: "object",
      properties: { note: { type: "string", description: long } },
    });
    const note = opts.find((o) => o.name === "note")!;
    expect(note.description.length).toBeLessThanOrEqual(100);
  });
});

describe("buildCommandBody", () => {
  it("truncates a command description longer than 100 chars", () => {
    const long = "y".repeat(250);
    const body = buildCommandBody({
      name: "triage",
      description: long,
      options: undefined,
    });
    expect(body.description.length).toBeLessThanOrEqual(100);
  });

  it("normalizes a command name to a lowercase valid slug (<=32, matches ^[-_a-z0-9]+$)", () => {
    const body = buildCommandBody({
      name: "MyCmd Name!",
      description: "x",
      options: undefined,
    });
    expect(body.name).toMatch(/^[-_a-z0-9]+$/);
    expect(body.name).toBe(body.name.toLowerCase());
    expect(body.name.length).toBeGreaterThanOrEqual(1);
    expect(body.name.length).toBeLessThanOrEqual(32);
  });
});

describe("registerCommands", () => {
  const spec: CommandSpec = {
    name: "triage",
    description: "Triage the thread",
    options: undefined,
  };

  it("registers to a guild when guildId is set", async () => {
    const put = vi.fn(
      async (_route: `/${string}`, _opts: { body: unknown }) => {},
    );
    await registerCommands({ put } as any, "app-1", "guild-9", [spec]);
    expect(put).toHaveBeenCalledTimes(1);
    const [route, body] = put.mock.calls[0]!;
    expect(String(route)).toContain("guild-9");
    expect((body as any).body[0]).toMatchObject({
      name: "triage",
      description: "Triage the thread",
    });
  });

  it("registers globally when guildId is absent", async () => {
    const put = vi.fn(
      async (_route: `/${string}`, _opts: { body: unknown }) => {},
    );
    await registerCommands({ put } as any, "app-1", undefined, [spec]);
    const [route] = put.mock.calls[0]!;
    expect(String(route)).not.toContain("guild");
    expect(String(route)).toContain("app-1");
  });
});
