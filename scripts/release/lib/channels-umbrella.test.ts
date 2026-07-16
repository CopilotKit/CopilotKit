import { describe, expect, it } from "vitest";
import {
  ADAPTERS,
  createConsumerSmokeSource,
  createConsumerWorkspaceYaml,
  createConsumerManifest,
  FAMILY,
  validatePackedManifests,
} from "./channels-umbrella.js";
import type { PackedManifest } from "./channels-umbrella.js";

function validManifests(): Map<string, PackedManifest> {
  const core: PackedManifest = {
    name: "@copilotkit/channels-core",
    version: "0.1.2",
    dependencies: { "@copilotkit/channels-ui": "~0.1.2" },
  };
  const ui: PackedManifest = {
    name: "@copilotkit/channels-ui",
    version: "0.1.2",
  };
  const adapters: PackedManifest[] = ADAPTERS.map((name, index) => ({
    name,
    version: `0.1.${index + 2}`,
    dependencies: {
      "@copilotkit/channels-core": "^0.1.2",
      "@copilotkit/channels-ui": "^0.1.2",
    },
  }));
  const family = [ui, core, ...adapters];
  const umbrella: PackedManifest = {
    name: "@copilotkit/channels",
    version: "0.2.0",
    dependencies: Object.fromEntries(
      family.map((manifest) => [manifest.name, manifest.version]),
    ),
  };

  return new Map(
    [...family, umbrella].map((manifest) => [manifest.name, manifest] as const),
  );
}

describe("validatePackedManifests", () => {
  it("accepts an exact compatible snapshot", () => {
    expect(validatePackedManifests(validManifests())).toEqual([]);
  });

  it("rejects a non-exact umbrella dependency", () => {
    const manifests = validManifests();
    manifests.get("@copilotkit/channels")!.dependencies![
      "@copilotkit/channels-core"
    ] = "^0.1.2";

    expect(validatePackedManifests(manifests)).toContainEqual(
      expect.stringContaining("must pack @copilotkit/channels-core exactly"),
    );
  });

  it("rejects an adapter range that excludes packed core", () => {
    const manifests = validManifests();
    manifests.get("@copilotkit/channels-slack")!.dependencies![
      "@copilotkit/channels-core"
    ] = "^0.2.0";

    expect(validatePackedManifests(manifests)).toContainEqual(
      expect.stringContaining("does not accept 0.1.2"),
    );
  });

  it("rejects an adapter back-edge to the umbrella", () => {
    const manifests = validManifests();
    manifests.get("@copilotkit/channels-slack")!.dependencies![
      "@copilotkit/channels"
    ] = "~0.1.1";

    expect(validatePackedManifests(manifests)).toContainEqual(
      expect.stringContaining(
        "@copilotkit/channels-slack must not depend on @copilotkit/channels",
      ),
    );
  });

  it("rejects a foundation back-edge to the umbrella", () => {
    const manifests = validManifests();
    manifests.get("@copilotkit/channels-core")!.dependencies![
      "@copilotkit/channels"
    ] = "^0.2.0";

    expect(validatePackedManifests(manifests)).toContainEqual(
      expect.stringContaining(
        "@copilotkit/channels-core must not depend on @copilotkit/channels",
      ),
    );
  });
});

describe("createConsumerManifest", () => {
  it("installs only the packed umbrella and overrides its local family", () => {
    expect(
      createConsumerManifest({
        umbrellaTarball: "/tmp/channels.tgz",
        packageManager: "pnpm@10.33.4",
        typescript: "^5.6.3",
        nodeTypes: "^22.10.0",
        overrides: new Map([
          ["@copilotkit/channels-core", "/tmp/channels-core.tgz"],
        ]),
      }),
    ).toEqual({
      name: "channels-umbrella-consumer",
      version: "0.0.0",
      private: true,
      type: "module",
      packageManager: "pnpm@10.33.4",
      dependencies: {
        "@copilotkit/channels": "file:/tmp/channels.tgz",
      },
      devDependencies: {
        "@types/node": "^22.10.0",
        typescript: "^5.6.3",
      },
      pnpm: {
        overrides: {
          "@copilotkit/channels-core": "file:/tmp/channels-core.tgz",
        },
      },
    });
  });

  it("keeps internal packages out of install dependencies even when local overrides are present", () => {
    const manifest = createConsumerManifest({
      umbrellaTarball: "/tmp/channels.tgz",
      packageManager: "pnpm@10.33.4",
      typescript: "^5.6.3",
      nodeTypes: "^22.10.0",
      overrides: new Map(FAMILY.map((name) => [name, `/tmp/${name}.tgz`])),
    });

    expect(manifest.dependencies).toEqual({
      "@copilotkit/channels": "file:/tmp/channels.tgz",
    });
  });
});

describe("createConsumerWorkspaceYaml", () => {
  it("exempts every Channels package from the release-age gate", () => {
    const workspace = createConsumerWorkspaceYaml();

    for (const name of FAMILY) {
      expect(workspace).toContain(`  - ${JSON.stringify(name)}\n`);
    }
  });
});

describe("createConsumerSmokeSource", () => {
  it("emits the public umbrella handoff contract", () => {
    const source = createConsumerSmokeSource();

    expect(source).toContain(
      'import { Button, createChannel, Message } from "@copilotkit/channels";',
    );
    expect(source).toContain(
      'import { slack } from "@copilotkit/channels/slack";',
    );
    expect(source).toContain(
      'import { intelligenceAdapter } from "@copilotkit/channels/intelligence";',
    );
    expect(source).not.toContain("createBot");
    expect(source).not.toContain("startChannelsOverRealtimeGateway");
    expect(source).not.toContain("@copilotkit/channels-core");
    expect(source).not.toContain("@copilotkit/channels-ui");
    for (const adapter of ADAPTERS) {
      expect(source).not.toContain(`from "${adapter}"`);
    }
  });
});
