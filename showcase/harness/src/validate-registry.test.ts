import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { validateHarnessRegistry } from "./validate-registry.js";
import { readFile } from "node:fs/promises";
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
const policy = {
  projectId: "project",
  forbiddenEnvironmentIds: ["production"],
  permanentServices: [],
  approvedImages: [],
};
const digest = createHash("sha256")
  .update(JSON.stringify(policy))
  .digest("hex");
const bytes = JSON.stringify({ schemaVersion: 1, runs: [] });
function setup() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SHOWCASE_REGISTRY_CONSUMER", "harness");
  vi.stubEnv(
    "SHOWCASE_DISPOSABLE_RUN_RECORDS_FILE",
    "https://runner.example/registry",
  );
  vi.stubEnv("SHOWCASE_DISPOSABLE_RUN_RECORDS_TOKEN", "fixture-token");
  vi.mocked(readFile).mockResolvedValue(
    JSON.stringify({ disposableLifecyclePolicy: policy }),
  );
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) =>
    init?.method === "POST"
      ? new Response("{}")
      : new Response(bytes, {
          headers: {
            "x-policy-sha256": digest,
            "x-snapshot-sha256": createHash("sha256")
              .update(bytes)
              .digest("hex"),
          },
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("uses the packaged policy and real shared reader without inventory or probes", async () => {
  const fetcher = setup();
  await validateHarnessRegistry(digest);
  expect(readFile).toHaveBeenCalledWith(
    "/app/data/railway-envs.generated.json",
    "utf8",
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenLastCalledWith(
    new URL("https://runner.example/consumers/harness"),
    expect.objectContaining({ method: "POST" }),
  );
});
it("rejects wrong artifact policy before any registry request", async () => {
  const fetcher = setup();
  await expect(validateHarnessRegistry("f".repeat(64))).rejects.toThrow(
    "Packaged policy differs",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects local or incorrectly configured execution", async () => {
  const fetcher = setup();
  vi.stubEnv("NODE_ENV", "development");
  await expect(validateHarnessRegistry(digest)).rejects.toThrow(
    "Deployed harness",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("fails closed if live registry advertises another policy", async () => {
  const fetcher = setup();
  fetcher.mockResolvedValue(
    new Response(bytes, { headers: { "x-policy-sha256": "f".repeat(64) } }),
  );
  await expect(validateHarnessRegistry(digest)).rejects.toThrow("refused");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
