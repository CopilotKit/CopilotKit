import { describe, expect, it, vi } from "vitest";
import { checkRegistry, unregisteredHelp } from "./publish-preflight.js";

function registry(versions: Record<string, string[]>) {
  return vi.fn(async (name: string) => versions[name] ?? []);
}

describe("checkRegistry", () => {
  it("passes packages that exist on npm with a free version", async () => {
    const fetchVersions = registry({
      "@copilotkit/core": ["1.83.0", "2.0.0-rc.12"],
      "@copilotkit/react-core": ["1.83.0", "2.0.0-rc.12"],
    });

    await expect(
      checkRegistry(
        [
          { name: "@copilotkit/core", version: "2.0.0-rc.13" },
          { name: "@copilotkit/react-core", version: "2.0.0-rc.13" },
        ],
        fetchVersions,
      ),
    ).resolves.toEqual({ unregistered: [], published: [] });
    expect(fetchVersions).toHaveBeenCalledTimes(2);
  });

  it("flags a package npm has never seen", async () => {
    await expect(
      checkRegistry(
        [
          { name: "@copilotkit/core", version: "2.0.0-rc.0" },
          { name: "@copilotkit/markdown", version: "2.0.0-rc.0" },
        ],
        registry({ "@copilotkit/core": ["1.83.0"] }),
      ),
    ).resolves.toEqual({
      unregistered: ["@copilotkit/markdown"],
      published: [],
    });
  });

  it("flags a version npm already has", async () => {
    await expect(
      checkRegistry(
        [{ name: "@copilotkit/core", version: "2.0.0-rc.12" }],
        registry({ "@copilotkit/core": ["1.83.0", "2.0.0-rc.12"] }),
      ),
    ).resolves.toEqual({
      unregistered: [],
      published: ["@copilotkit/core@2.0.0-rc.12"],
    });
  });

  it("propagates a registry failure instead of guessing", async () => {
    const fetchVersions = vi.fn(async () => {
      throw new Error("npm registry returned 503");
    });

    await expect(
      checkRegistry(
        [{ name: "@copilotkit/core", version: "2.0.0-rc.13" }],
        fetchVersions,
      ),
    ).rejects.toThrow("503");
  });
});

describe("unregisteredHelp", () => {
  it("names the packages and the trusted publisher to add", () => {
    const help = unregisteredHelp(["@copilotkit/markdown"]);
    expect(help).toContain("Never published to npm: @copilotkit/markdown.");
    expect(help).toContain("workflow publish-release.yml, environment npm");
  });
});
