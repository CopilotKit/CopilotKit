import { expect, it, vi } from "vitest";
import {
  HARNESS_SCOPE,
  HARNESS_BASELINE,
  rolloutHarnessPolicy,
} from "./rollout-harness-policy.mjs";
function fixture() {
  const baselineConfig = {
    source: {
      image: "ghcr.io/copilotkit/showcase-harness:latest",
      autoUpdates: { type: "disabled" },
    },
    deploy: { healthcheckPath: "/health" },
    networking: { privateNetworkEndpoint: "showcase-ops" },
  };
  const targetImage = `ghcr.io/copilotkit/showcase-harness@sha256:${"a".repeat(64)}`;
  const targetId = "c92508c8-15d6-4603-a061-f4573f8ce80d";
  const baselineDeployment: { id: string; image: string; status: string } = {
    ...HARNESS_BASELINE,
  };
  let state = {
    ...HARNESS_SCOPE,
    config: structuredClone(baselineConfig),
    volumes: [],
    staged: null,
    latestDeployment: baselineDeployment,
  };
  const events: string[] = [];
  const provider = {
    inspect: vi.fn(async (): Promise<unknown> => structuredClone(state)),
    setImage: vi.fn(async (_scope: unknown, image: string) => {
      events.push("source");
      state.config.source.image = image;
      return true;
    }),
    deploy: vi.fn(async () => {
      events.push("deploy");
      state.latestDeployment = {
        id: targetId,
        image: targetImage,
        status: "SUCCESS",
      };
      return targetId;
    }),
  };
  const journal = {
    claim: vi.fn(async (value: { phase: string }) => {
      events.push(value.phase);
    }),
    save: vi.fn(async (value: { phase: string }) => {
      events.push(value.phase);
    }),
  };
  const input = {
    operationId: "github-655515393-123",
    targetImage,
    baselineConfig,
    provider,
    journal,
    assertCandidateDrained: vi.fn(async () => {}),
    timeoutMs: 50,
  };
  return { input, provider, journal, events, targetId, state };
}
it("records each send before mutation, changes only image and returns verified deployment", async () => {
  const f = fixture();
  const result = await rolloutHarnessPolicy(f.input);
  expect(result.deploymentId).toBe(f.targetId);
  expect(f.events).toEqual([
    "source-requested",
    "source",
    "deploy-requested",
    "deploy",
    "deploy-acknowledged",
    "verified",
  ]);
  expect(f.provider.setImage).toHaveBeenCalledWith(
    HARNESS_SCOPE,
    f.input.targetImage,
    expect.any(AbortSignal),
  );
});
it.each(["volume", "staged", "config", "deployment"])(
  "refuses baseline %s drift before mutation",
  async (field) => {
    const f = fixture();
    f.provider.inspect.mockImplementation(async () => ({
      ...structuredClone(f.state),
      ...(field === "volume"
        ? { volumes: [{ id: "unexpected" }] }
        : field === "staged"
          ? { staged: {} }
          : field === "config"
            ? { config: {} }
            : { latestDeployment: { ...HARNESS_BASELINE, id: f.targetId } }),
    }));
    await expect(rolloutHarnessPolicy(f.input)).rejects.toThrow();
    expect(f.journal.claim).not.toHaveBeenCalled();
    expect(f.provider.setImage).not.toHaveBeenCalled();
  },
);
it.each(["source-requested", "deploy-requested", "deploy-acknowledged"])(
  "never resends retained incomplete %s",
  async (phase) => {
    const f = fixture();
    const result = await rolloutHarnessPolicy(f.input);
    vi.clearAllMocks();
    await expect(
      rolloutHarnessPolicy({
        ...f.input,
        previousReceipt: { ...result, phase },
      }),
    ).rejects.toThrow("Incomplete");
    expect(f.provider.setImage).not.toHaveBeenCalled();
    expect(f.provider.deploy).not.toHaveBeenCalled();
  },
);
it("retains unknown deploy attempt without resending", async () => {
  const f = fixture();
  f.provider.deploy.mockRejectedValue(new Error("unknown outcome"));
  await expect(rolloutHarnessPolicy(f.input)).rejects.toThrow(
    "unknown outcome",
  );
  expect(f.events).toEqual(["source-requested", "source", "deploy-requested"]);
  expect(f.provider.deploy).toHaveBeenCalledOnce();
});
it("does not mutate if durable claim fails", async () => {
  const f = fixture();
  f.journal.claim.mockRejectedValue(new Error("already claimed"));
  await expect(rolloutHarnessPolicy(f.input)).rejects.toThrow(
    "already claimed",
  );
  expect(f.provider.setImage).not.toHaveBeenCalled();
});
it("verified replay is read-only and still verifies configuration", async () => {
  const f = fixture();
  const result = await rolloutHarnessPolicy(f.input);
  vi.clearAllMocks();
  await expect(
    rolloutHarnessPolicy({ ...f.input, previousReceipt: result }),
  ).resolves.toEqual(result);
  expect(f.provider.setImage).not.toHaveBeenCalled();
  expect(f.provider.deploy).not.toHaveBeenCalled();
  expect(f.journal.save).not.toHaveBeenCalled();
});
it("blocks explicit deploy after automatic deployment during image update", async () => {
  const f = fixture();
  const original = f.provider.setImage.getMockImplementation()!;
  f.provider.setImage.mockImplementation(async (scope, image) => {
    await original(scope, image);
    f.state.latestDeployment.id = f.targetId;
    return true;
  });
  await expect(rolloutHarnessPolicy(f.input)).rejects.toThrow(
    "Unexpected automatic",
  );
  expect(f.provider.deploy).not.toHaveBeenCalled();
});
it("requires drain ownership before any provider calls", async () => {
  const f = fixture();
  f.input.assertCandidateDrained.mockRejectedValue(new Error("owner changed"));
  await expect(rolloutHarnessPolicy(f.input)).rejects.toThrow("owner changed");
  expect(f.provider.inspect).not.toHaveBeenCalled();
});
it("does not resend a deploy that exceeds its deadline", async () => {
  const f = fixture();
  f.provider.deploy.mockImplementation(() => new Promise<string>(() => {}));
  await expect(rolloutHarnessPolicy(f.input)).rejects.toThrow("deadline");
  expect(f.provider.deploy).toHaveBeenCalledOnce();
  expect(f.events).toEqual(["source-requested", "source", "deploy-requested"]);
  expect(f.journal.save).toHaveBeenCalledTimes(1);
});
it("cannot deploy when durable deploy intent cannot be saved", async () => {
  const f = fixture();
  f.journal.save.mockRejectedValue(new Error("journal unavailable"));
  await expect(rolloutHarnessPolicy(f.input)).rejects.toThrow(
    "journal unavailable",
  );
  expect(f.provider.deploy).not.toHaveBeenCalled();
});
it("an exclusive durable claim admits only one concurrent mutation sequence", async () => {
  const f = fixture();
  let claimed = false;
  f.journal.claim.mockImplementation(async () => {
    if (claimed) throw new Error("already claimed");
    claimed = true;
  });
  const results = await Promise.allSettled([
    rolloutHarnessPolicy(f.input),
    rolloutHarnessPolicy(f.input),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(f.provider.setImage).toHaveBeenCalledOnce();
  expect(f.provider.deploy).toHaveBeenCalledOnce();
});
