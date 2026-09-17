import { describe, expect, it } from "vitest";
import {
  collectStagingFloatTargets,
  needsStagingFloat,
  stagingLatestRef,
} from "./float-staging-latest";
import { ENV_ID_BY_NAME } from "./railway-envs";

const DIGEST =
  "ghcr.io/copilotkit/showcase-mastra@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("stagingLatestRef", () => {
  it("builds the mutable :latest tag for a GHCR repo", () => {
    expect(stagingLatestRef("showcase-aimock")).toBe(
      "ghcr.io/copilotkit/showcase-aimock:latest",
    );
  });
});

describe("needsStagingFloat", () => {
  it("is true for a digest pin", () => {
    expect(needsStagingFloat(DIGEST)).toBe(true);
  });

  it("is false for :latest", () => {
    expect(needsStagingFloat("ghcr.io/copilotkit/showcase-mastra:latest")).toBe(
      false,
    );
  });

  it("is false when the image is missing", () => {
    expect(needsStagingFloat(null)).toBe(false);
  });
});

describe("collectStagingFloatTargets", () => {
  const stagingEnvId = ENV_ID_BY_NAME.staging;
  const prodEnvId = ENV_ID_BY_NAME.prod;

  it("selects gateValidated staging digest pins and maps them to :latest", () => {
    const targets = collectStagingFloatTargets({
      project: {
        services: {
          edges: [
            {
              node: {
                id: "svc-aimock",
                name: "aimock",
                serviceInstances: {
                  edges: [
                    {
                      node: {
                        environmentId: stagingEnvId,
                        source: {
                          image:
                            "ghcr.io/copilotkit/showcase-aimock@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                        },
                      },
                    },
                    {
                      node: {
                        environmentId: prodEnvId,
                        source: {
                          image:
                            "ghcr.io/copilotkit/showcase-aimock@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                        },
                      },
                    },
                  ],
                },
              },
            },
            {
              node: {
                id: "svc-mastra",
                name: "showcase-mastra",
                serviceInstances: {
                  edges: [
                    {
                      node: {
                        environmentId: stagingEnvId,
                        source: {
                          image: "ghcr.io/copilotkit/showcase-mastra:latest",
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    });

    expect(targets).toEqual([
      {
        service: "aimock",
        serviceId: "svc-aimock",
        current:
          "ghcr.io/copilotkit/showcase-aimock@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        next: "ghcr.io/copilotkit/showcase-aimock:latest",
      },
    ]);
  });

  it("returns nothing when Railway has no project", () => {
    expect(collectStagingFloatTargets({ project: null })).toEqual([]);
  });
});
