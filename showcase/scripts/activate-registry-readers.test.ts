import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { activateRegistryReaders } from "./activate-registry-readers.mjs";

const policy = JSON.parse(
  readFileSync(
    new URL("./railway-envs.generated.json", import.meta.url),
    "utf8",
  ),
).disposableLifecyclePolicy;
const digest = createHash("sha256")
  .update(JSON.stringify(policy))
  .digest("hex");
function fixture() {
  const notBefore = new Date(Date.now() - 1000).toISOString();
  const image = `ghcr.io/copilotkit/showcase-harness@sha256:${"a".repeat(64)}`;
  const id = "4922b45b-6981-4559-be2f-fbbca9123323";
  const recordsFile = "https://runner.example/registry";
  const runReaders = vi.fn(async () => {});
  const input = {
    assertCandidateDrained: vi.fn(async () => {}),
    policySha256: digest,
    recordsFile,
    notBefore,
    harnessDeploymentId: id,
    harnessImage: image,
    timeoutMs: 25,
    env: Object.fromEntries(
      [
        "SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN",
        "RAILWAY_TOKEN",
        "GITHUB_WORKFLOW_REF",
        "GITHUB_SHA",
        "GITHUB_RUN_ID",
        "GITHUB_RUN_ATTEMPT",
        "GITHUB_WORKFLOW",
      ].map((key) => [key, "fixture-only"]),
    ) as Record<string, string>,
    readHarnessDeployment: vi.fn(async () => ({
      id,
      image,
      status: "SUCCESS",
    })),
    readConsumerReceipt: vi.fn(async (consumer: string) => ({
      consumer,
      reader: "railway-lifecycle-records-v1",
      recordsFile,
      policySha256: digest,
      sha256: "b".repeat(64),
      at: new Date().toISOString(),
    })),
  };
  input.env.SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE = recordsFile;
  return { input, runReaders };
}
it("requires actual deployed harness identity plus fresh matching receipts from all three readers", async () => {
  const { input, runReaders } = fixture();
  const result = await activateRegistryReaders(input, { runReaders });
  expect(runReaders).toHaveBeenCalledOnce();
  expect(input.readHarnessDeployment).toHaveBeenCalledTimes(2);
  expect(
    result.receipts.map((receipt: { consumer: string }) => receipt.consumer),
  ).toEqual(["image-gate", "ruby-promotion", "harness"]);
});
it.each(["image", "id", "status"])(
  "rejects wrong deployed harness %s before invoking any reader",
  async (field) => {
    const { input, runReaders } = fixture();
    input.readHarnessDeployment.mockResolvedValue({
      id: input.harnessDeploymentId,
      image: input.harnessImage,
      status: "SUCCESS",
      [field]: "wrong",
    });
    await expect(
      activateRegistryReaders(input, { runReaders }),
    ).rejects.toThrow(/Harness/);
    expect(runReaders).not.toHaveBeenCalled();
  },
);
it.each(["policySha256", "recordsFile", "reader", "at"])(
  "never treats stale/mismatched harness %s as activation",
  async (field) => {
    const { input, runReaders } = fixture();
    const original = input.readConsumerReceipt.getMockImplementation()!;
    input.readConsumerReceipt.mockImplementation(async (role) => ({
      ...(await original(role)),
      ...(role === "harness" ? { [field]: "stale" } : {}),
    }));
    await expect(
      activateRegistryReaders(input, { runReaders }),
    ).rejects.toThrow();
  },
);
it("stops when genuine reader execution fails", async () => {
  const { input, runReaders } = fixture();
  runReaders.mockRejectedValue(new Error("Reader refused"));
  await expect(activateRegistryReaders(input, { runReaders })).rejects.toThrow(
    "Reader refused",
  );
  expect(input.readConsumerReceipt).not.toHaveBeenCalled();
});
it("rejects a policy different from the packaged reader before network calls", async () => {
  const { input, runReaders } = fixture();
  input.policySha256 = "f".repeat(64);
  await expect(activateRegistryReaders(input, { runReaders })).rejects.toThrow(
    "Local reader policy",
  );
  expect(input.readHarnessDeployment).not.toHaveBeenCalled();
});
it("rechecks deployed identity after readers run", async () => {
  const { input, runReaders } = fixture();
  input.readHarnessDeployment
    .mockResolvedValueOnce({
      id: input.harnessDeploymentId,
      image: input.harnessImage,
      status: "SUCCESS",
    })
    .mockResolvedValue({
      id: input.harnessDeploymentId,
      image: input.harnessImage,
      status: "REMOVED",
    });
  await expect(activateRegistryReaders(input, { runReaders })).rejects.toThrow(
    "Harness",
  );
});

it("refuses to activate before candidate verification and drain", async () => {
  const { input, runReaders } = fixture();
  input.assertCandidateDrained.mockRejectedValue(
    new Error("Not verified or drained"),
  );
  await expect(activateRegistryReaders(input, { runReaders })).rejects.toThrow(
    "Not verified or drained",
  );
  expect(runReaders).not.toHaveBeenCalled();
  expect(input.readHarnessDeployment).not.toHaveBeenCalled();
});
it("revalidates drain ownership before reporting success", async () => {
  const { input, runReaders } = fixture();
  input.assertCandidateDrained
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(new Error("Owner changed"));
  await expect(activateRegistryReaders(input, { runReaders })).rejects.toThrow(
    "Owner changed",
  );
});
