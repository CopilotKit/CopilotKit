import { describe, it, expect, vi } from "vitest";
import {
  crossEnvPinDriftDiscoverySource,
  imageRepoFromRef,
} from "./cross-env-pin-drift-discovery.js";
import { railwayServicesSource } from "./railway-services.js";
import type { DiscoveryContext } from "../types.js";
import type { Logger } from "../../types/index.js";

const DEFAULT_PROD_ENV_ID = "b14919f4-6417-429f-848d-c6ae2201e04f";
const DEFAULT_STAGING_ENV_ID = "8edfef02-ea09-4a20-8689-261f21cc2849";

function noopLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

function ctx(env: Record<string, string | undefined>): DiscoveryContext {
  return {
    fetchImpl: (() => {
      throw new Error("fetch should not be called — railway path is mocked");
    }) as unknown as typeof fetch,
    logger: noopLogger(),
    env,
  };
}

describe("imageRepoFromRef — strip tag/digest to the bare GHCR repo", () => {
  it("strips a :tag", () => {
    expect(imageRepoFromRef("ghcr.io/copilotkit/showcase-x:latest")).toBe(
      "ghcr.io/copilotkit/showcase-x",
    );
  });
  it("strips an @sha256 digest", () => {
    expect(imageRepoFromRef("ghcr.io/copilotkit/showcase-x@sha256:abc")).toBe(
      "ghcr.io/copilotkit/showcase-x",
    );
  });
  it("strips both tag and digest", () => {
    expect(
      imageRepoFromRef("ghcr.io/copilotkit/showcase-x:latest@sha256:abc"),
    ).toBe("ghcr.io/copilotkit/showcase-x");
  });
  it("returns a bare repo unchanged", () => {
    expect(imageRepoFromRef("ghcr.io/copilotkit/showcase-x")).toBe(
      "ghcr.io/copilotkit/showcase-x",
    );
  });
  it("returns empty string for an empty ref", () => {
    expect(imageRepoFromRef("")).toBe("");
  });
});

describe("crossEnvPinDriftDiscoverySource — stamps prod/staging env-ids per service", () => {
  it("uses the SSOT default env-ids and derives imageRepo per service", async () => {
    vi.spyOn(railwayServicesSource, "enumerate").mockResolvedValueOnce([
      {
        name: "showcase-langgraph-python",
        imageRef: "ghcr.io/copilotkit/showcase-langgraph-python:latest",
        publicUrl: "https://x",
        env: {},
        shape: "package",
        deployedDigest: "",
        demos: [],
        notSupportedFeatures: [],
        deployedAt: "",
      },
    ] as never);

    const records = await crossEnvPinDriftDiscoverySource.enumerate(ctx({}), {
      namePrefix: "showcase-",
    });

    expect(records).toEqual([
      {
        name: "showcase-langgraph-python",
        imageRepo: "ghcr.io/copilotkit/showcase-langgraph-python",
        prodEnvId: DEFAULT_PROD_ENV_ID,
        stagingEnvId: DEFAULT_STAGING_ENV_ID,
      },
    ]);
  });

  it("honors RAILWAY_PROD/STAGING_ENVIRONMENT_ID overrides", async () => {
    vi.spyOn(railwayServicesSource, "enumerate").mockResolvedValueOnce([
      {
        name: "showcase-x",
        imageRef: "ghcr.io/copilotkit/showcase-x:latest",
        publicUrl: "https://x",
        env: {},
        shape: "package",
        deployedDigest: "",
        demos: [],
        notSupportedFeatures: [],
        deployedAt: "",
      },
    ] as never);

    const records = await crossEnvPinDriftDiscoverySource.enumerate(
      ctx({
        RAILWAY_PROD_ENVIRONMENT_ID: "prod-override",
        RAILWAY_STAGING_ENVIRONMENT_ID: "staging-override",
      }),
      {},
    );

    expect(records[0]).toMatchObject({
      name: "showcase-x",
      prodEnvId: "prod-override",
      stagingEnvId: "staging-override",
    });
  });

  it("propagates a railway-services enumeration throw (single keyed error tile)", async () => {
    vi.spyOn(railwayServicesSource, "enumerate").mockRejectedValueOnce(
      new Error("railway down"),
    );
    await expect(
      crossEnvPinDriftDiscoverySource.enumerate(ctx({}), {}),
    ).rejects.toThrow("railway down");
  });
});
