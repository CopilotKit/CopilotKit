import { expect, test, vi } from "vitest";
import { buildContentParts } from "./content-parts.js";

test("logs a bounded managed-asset restore outcome and duration", async () => {
  const log = vi.fn();

  await expect(
    buildContentParts(
      [
        {
          handle: "asset_01",
          filename: "diagram.png",
          mimeType: "image/png",
        },
      ],
      vi.fn().mockResolvedValue({
        bytes: new Uint8Array([137, 80, 78, 71]),
        mimeType: "image/png",
      }),
      log,
    ),
  ).resolves.toHaveLength(1);

  expect(log).toHaveBeenCalledWith("channel managed asset restore", {
    outcome: "restored",
    code: "asset_restored",
    durationMs: expect.any(Number),
    byteSize: 4,
  });
});

test("logs a bounded restore failure without raw error details", async () => {
  const log = vi.fn();

  await buildContentParts(
    [
      {
        handle: "asset_01",
        filename: "diagram.png",
        mimeType: "image/png",
      },
    ],
    vi.fn().mockRejectedValue(new Error("secret provider response")),
    log,
  );

  expect(log).toHaveBeenCalledWith("channel managed asset restore", {
    outcome: "failed",
    code: "asset_restore_failed",
    durationMs: expect.any(Number),
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "secret provider response",
  );
});
