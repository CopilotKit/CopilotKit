import { afterEach, expect, it, vi } from "vitest";
import { CopilotKitIntelligence } from "../client";
const etag = `"${"a".repeat(64)}"`;
const client = () =>
  new CopilotKitIntelligence({
    apiKey: "key",
    apiUrl: "https://api.example.com",
    wsUrl: "wss://example.com",
  });
const snapshot = {
  containerId: "a",
  status: "snapshot",
  revision: "1",
  etag,
  contentType: "application/zip",
  bytesBase64: "UEsDBA==",
};
afterEach(() => vi.unstubAllGlobals());
it("fetches all snapshots in one canonical POST and decodes bytes", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      containers: [
        snapshot,
        {
          containerId: "b",
          status: "error",
          error: { code: "REVISION_REVOKED", retryable: false },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const result = await client().getLearnedSkillsSnapshots({
    containers: [{ containerId: "a" }, { containerId: "b", revision: "2" }],
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(
    "https://api.example.com/api/v1/learning/skills/batch",
  );
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({
      containers: [{ containerId: "a" }, { containerId: "b", revision: "2" }],
    }),
  });
  expect(result[0]).toMatchObject({
    containerId: "a",
    status: "snapshot",
    revision: "1",
    etag,
    contentType: "application/zip",
    bytes: new Uint8Array([80, 75, 3, 4]),
  });
  expect(result[1]).toMatchObject({
    status: "error",
    error: { code: "REVISION_REVOKED" },
  });
});
it.each(
  [
    [],
    [snapshot, snapshot],
    [{ ...snapshot, containerId: "unknown" }],
    [{ ...snapshot, bytesBase64: "!!!" }],
    [{ ...snapshot, etag: "bad" }],
    [{ ...snapshot, status: "unchanged", bytesBase64: undefined }],
    [{ ...snapshot, revision: "" }],
  ].map((containers) => ({ containers })),
)("rejects malformed batch envelopes", async ({ containers }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ containers })),
  );
  await expect(
    client().getLearnedSkillsSnapshots({ containers: [{ containerId: "a" }] }),
  ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
});
it("accepts a matching unchanged result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        containers: [
          { containerId: "a", status: "unchanged", revision: "1", etag },
        ],
      }),
    ),
  );
  expect(
    await client().getLearnedSkillsSnapshots({
      containers: [{ containerId: "a", ifNoneMatch: etag }],
    }),
  ).toHaveLength(1);
});
it("preserves a confirmed denial when a sibling is malformed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        containers: [
          { ...snapshot, bytesBase64: "bad" },
          {
            containerId: "b",
            status: "error",
            error: { code: "REVISION_REVOKED", retryable: false },
          },
        ],
      }),
    ),
  );
  await expect(
    client().getLearnedSkillsSnapshots({
      containers: [{ containerId: "a" }, { containerId: "b" }],
    }),
  ).rejects.toMatchObject({ code: "REVISION_REVOKED" });
});
it.each(
  [
    [],
    Array.from({ length: 51 }, (_, i) => ({ containerId: String(i) })),
    [{ containerId: "a" }, { containerId: "a" }],
    [{ containerId: "a", revision: " " }],
    [{ containerId: "a", ifNoneMatch: "bad" }],
  ].map((containers) => ({ containers })),
)(
  "rejects invalid batch configuration before transport",
  async ({ containers }) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      client().getLearnedSkillsSnapshots({ containers }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    expect(fetch).not.toHaveBeenCalled();
  },
);
it("preserves caller cancellation and maps deadlines", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    client().getLearnedSkillsSnapshots({
      containers: [{ containerId: "a" }],
      signal: controller.signal,
    }),
  ).rejects.toBe(controller.signal.reason);
  const timeout = new AbortController();
  timeout.abort(new DOMException("timeout", "TimeoutError"));
  await expect(
    client().getLearnedSkillsSnapshots({
      containers: [{ containerId: "a" }],
      signal: timeout.signal,
    }),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
});
it("preserves HTTP denial when reading its body hits the deadline", async () => {
  const controller = new AbortController();
  const response = new Response(null, { status: 403 });
  vi.spyOn(response, "json").mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      setTimeout(
        () => controller.abort(new DOMException("timeout", "TimeoutError")),
        0,
      );
      return response;
    }),
  );
  await expect(
    client().getLearnedSkillsSnapshots({
      containers: [{ containerId: "a" }],
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ code: "AUTHORIZATION_FAILED", retryable: false });
});
