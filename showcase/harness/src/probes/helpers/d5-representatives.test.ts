import { describe, it, expect } from "vitest";
import {
  D5_REPRESENTATIVES,
  getD5Representative,
} from "./d5-representatives.js";
import { D5_REGISTRY, __clearD5RegistryForTesting } from "./d5-registry.js";
import type { D5FeatureType } from "./d5-registry.js";
import { glob } from "glob";
import path from "node:path";

describe("D5_REPRESENTATIVES", () => {
  it("maps known feature types to fixture filenames", () => {
    expect(D5_REPRESENTATIVES["agentic-chat"]).toBe("agentic-chat.json");
    expect(D5_REPRESENTATIVES["hitl-text-input"]).toBe("hitl-in-chat.json");
    expect(D5_REPRESENTATIVES["tool-rendering"]).toBe("tool-rendering.json");
    expect(D5_REPRESENTATIVES["gen-ui-agent"]).toBe("gen-ui-agent.json");
    expect(D5_REPRESENTATIVES["shared-state-read"]).toBe(
      "shared-state-read.json",
    );
    expect(D5_REPRESENTATIVES["subagents"]).toBe("subagents.json");
  });

  it("all values end in .json", () => {
    for (const [, filename] of Object.entries(D5_REPRESENTATIVES)) {
      expect(filename).toMatch(/\.json$/);
    }
  });

  it("covers every D5FeatureType that has a registered script", async () => {
    // Dynamically load all D5 scripts to populate the registry, just as
    // the production driver does at boot.
    __clearD5RegistryForTesting();
    const scriptsDir = path.resolve(__dirname, "../scripts");
    const scriptFiles = await glob("d5-*.ts", {
      cwd: scriptsDir,
      ignore: ["*.test.ts", "_*"],
    });
    for (const file of scriptFiles) {
      await import(path.join(scriptsDir, file));
    }

    const registeredTypes = [...D5_REGISTRY.keys()] as D5FeatureType[];
    expect(registeredTypes.length).toBeGreaterThan(0);

    const missing = registeredTypes.filter(
      (ft) => D5_REPRESENTATIVES[ft] === undefined,
    );
    expect(
      missing,
      `D5_REPRESENTATIVES is missing entries for registered feature types: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("getD5Representative", () => {
  it("returns the filename for a known feature type", () => {
    expect(getD5Representative("agentic-chat")).toBe("agentic-chat.json");
  });

  it("returns undefined for a feature type not in the map", () => {
    const result = getD5Representative("nonexistent-feature" as D5FeatureType);
    expect(result).toBeUndefined();
  });
});
