import { describe, expect, it } from "vitest";
import { loadSkill, runSkillScript } from "../skill-registry/skill-content";
import { scriptedSnapshot as snapshot, sha } from "./scripted-snapshot";

const input = {
  deals: [
    { amount: 100, currency: "USD" },
    { amount: 100, currency: "EUR" },
  ],
  rates: { USD: 1, EUR: 1.08 },
};

describe("runSkillScript", () => {
  it("runs a delivered action script on the input and returns its output", async () => {
    expect(
      JSON.parse(
        await runSkillScript(snapshot(), "pipeline-total", "usd-total", input),
      ),
    ).toEqual({
      skill_name: "pipeline-total",
      script: "usd-total",
      output: { totalUsd: 208 },
    });
  });

  it("refuses a script whose content does not match its manifest hash", async () => {
    await expect(
      runSkillScript(
        snapshot("function run() { return 1; }"),
        "pipeline-total",
        "usd-total",
        input,
      ),
    ).rejects.toThrow("Skill script is unavailable.");
  });

  it("refuses a script that the manifest does not list", async () => {
    await expect(
      runSkillScript(snapshot(), "pipeline-total", "other", input),
    ).rejects.toThrow("Skill script is unavailable.");
  });

  it("gives the script no host APIs, clock, or randomness", async () => {
    const probe =
      "function run() { return { host: typeof fetch !== 'undefined' || typeof require !== 'undefined' || typeof process !== 'undefined', clock: typeof Date !== 'undefined' }; }";
    const result = JSON.parse(
      await runSkillScript(
        snapshot(probe, { sha256: sha(probe) }),
        "pipeline-total",
        "usd-total",
        {},
      ),
    );
    expect(result.output).toEqual({ host: false, clock: false });
  });

  it("stops a script that runs too long", async () => {
    const loop = "function run() { for (;;) {} }";
    await expect(
      runSkillScript(
        snapshot(loop, { sha256: sha(loop) }),
        "pipeline-total",
        "usd-total",
        {},
      ),
    ).rejects.toThrow("Skill script failed: timeout.");
  });
});

describe("finding a skill's scripts", () => {
  it("lists a skill's scripts with what their input holds when the skill loads", () => {
    expect(JSON.parse(loadSkill(snapshot(), "pipeline-total")).scripts).toEqual(
      [{ name: "usd-total", input: "The deals tool result." }],
    );
  });

  it("names the skill's scripts when a script name is wrong", async () => {
    await expect(
      runSkillScript(snapshot(), "pipeline-total", "compute_total", input),
    ).rejects.toThrow(
      "Skill script is unavailable. Scripts of pipeline-total: usd-total.",
    );
  });

  it("accepts the script: prefix that skill text uses", async () => {
    expect(
      JSON.parse(
        await runSkillScript(
          snapshot(),
          "pipeline-total",
          "script:usd-total",
          input,
        ),
      ).output,
    ).toEqual({ totalUsd: 208 });
  });
});

it("reads input that the model passed as a JSON string", async () => {
  expect(
    JSON.parse(
      await runSkillScript(
        snapshot(),
        "pipeline-total",
        "usd-total",
        JSON.stringify(input),
      ),
    ).output,
  ).toEqual({ totalUsd: 208 });
});
