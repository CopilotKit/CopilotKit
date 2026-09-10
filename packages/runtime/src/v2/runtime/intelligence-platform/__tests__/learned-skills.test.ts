import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitIntelligence } from "../client";

const etag = `"${"a".repeat(64)}"`;
const revision = "opaque revision/+?";
const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
const headers = {
  "content-type": "application/zip",
  "x-copilotkit-skills-revision": revision,
  etag,
};
const fetchMock = vi.fn();
let client: CopilotKitIntelligence;
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  client = new CopilotKitIntelligence({
    apiKey: "cpk-private-key",
    apiUrl: "https://api.example.com/",
    wsUrl: "wss://ws.example.com",
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("getLearnedSkillsSnapshot", () => {
  it("returns untouched bytes and metadata using the canonical credential and URL", async () => {
    fetchMock.mockResolvedValue(new Response(bytes, { headers }));
    const signal = new AbortController().signal;
    expect(
      await client.getLearnedSkillsSnapshot({
        containerId: "folder/id",
        revision,
        ifNoneMatch: etag,
        signal,
      }),
    ).toEqual({
      status: "snapshot",
      bytes,
      revision,
      etag,
      contentType: "application/zip",
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `https://api.example.com/api/v1/learning/containers/folder%2Fid/skills?revision=${encodeURIComponent(revision).replace(/%20/g, "+")}`,
      {
        method: "GET",
        headers: {
          Authorization: "Bearer cpk-private-key",
          Accept: "application/zip",
          "If-None-Match": etag,
        },
        signal,
        redirect: "error",
      },
    );
  });

  it("returns a distinct unchanged result without reading a 304 body", async () => {
    const response = new Response(null, { status: 304, headers });
    const read = vi.spyOn(response, "arrayBuffer");
    fetchMock.mockResolvedValue(response);
    expect(
      await client.getLearnedSkillsSnapshot({
        containerId: "c",
        ifNoneMatch: etag,
      }),
    ).toEqual({ status: "unchanged", revision, etag });
    expect(read).not.toHaveBeenCalled();
  });

  it("does not cache or add optional request values", async () => {
    fetchMock.mockImplementation(() => new Response(bytes, { headers }));
    await client.getLearnedSkillsSnapshot({ containerId: "c" });
    await client.getLearnedSkillsSnapshot({ containerId: "c" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/api/v1/learning/containers/c/skills",
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "If-None-Match",
    );
  });

  it.each([
    "AUTHENTICATION_FAILED",
    "AUTHORIZATION_FAILED",
    "ENTITLEMENT_REQUIRED",
    "DELIVERY_DISABLED",
    "CONTAINER_NOT_FOUND",
    "REVISION_NOT_FOUND",
    "REVISION_REVOKED",
  ])(
    "preserves lifecycle code %s without exposing server messages",
    async (code) => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code,
              message: "cpk-private-key secret body",
              category: "permanent",
              retryable: false,
            },
            requestId: "req",
            traceId: "trace",
          }),
          { status: 403 },
        ),
      );
      const error = await client
        .getLearnedSkillsSnapshot({ containerId: "c" })
        .catch((e) => e);
      expect(error.name).toBe("LearnedSkillsError");
      expect(error).toMatchObject({ code, retryable: false });
      expect(String(error)).not.toContain("secret body");
      expect(error.cause).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([404, 200, 204])(
    "rejects unsupported response status/body %s",
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response(status === 204 ? null : "<html>secret</html>", { status }),
      );
      await expect(
        client.getLearnedSkillsSnapshot({ containerId: "c" }),
      ).rejects.toMatchObject({
        code: status === 200 ? "INVALID_SNAPSHOT" : "UNSUPPORTED_SERVER",
      });
    },
  );

  it.each([
    { ...headers, etag: `W/${etag}` },
    { ...headers, etag: "unquoted" },
    { ...headers, "x-copilotkit-skills-revision": "" },
    { ...headers, "content-type": "application/json" },
  ])("rejects invalid snapshot metadata", async (invalidHeaders) => {
    fetchMock.mockResolvedValue(
      new Response(bytes, { headers: invalidHeaders }),
    );
    await expect(
      client.getLearnedSkillsSnapshot({ containerId: "c" }),
    ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT", retryable: false });
  });

  it("rejects a mismatched exact revision", async () => {
    fetchMock.mockResolvedValue(new Response(bytes, { headers }));
    await expect(
      client.getLearnedSkillsSnapshot({
        containerId: "c",
        revision: "different",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it.each([
    { containerId: "" },
    { containerId: "c", revision: "" },
    { containerId: "c", ifNoneMatch: "bad\nheader" },
  ])("rejects invalid request configuration before fetch", async (params) => {
    await expect(client.getLearnedSkillsSnapshot(params)).rejects.toMatchObject(
      { code: "INVALID_CONFIG", retryable: false },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps network failures without retrying", async () => {
    const cause = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(cause);
    await expect(
      client.getLearnedSkillsSnapshot({ containerId: "c" }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true, cause });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.getLearnedSkillsSnapshot({
        containerId: "c",
        signal: controller.signal,
      }),
    ).rejects.toBe(controller.signal.reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors cancellation before returning an unchanged response", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      return new Response(null, { status: 304, headers });
    });
    await expect(
      client.getLearnedSkillsSnapshot({
        containerId: "c",
        ifNoneMatch: etag,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("maps caller deadlines to TIMEOUT", async () => {
    const controller = new AbortController();
    const reason = new DOMException("deadline", "TimeoutError");
    controller.abort(reason);
    await expect(
      client.getLearnedSkillsSnapshot({
        containerId: "c",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
      cause: reason,
    });
  });

  it("honors cancellation while reading response bytes", async () => {
    const controller = new AbortController();
    const response = new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(bytes);
        },
      }),
      { headers },
    );
    vi.spyOn(response, "arrayBuffer").mockImplementation(async () => {
      controller.abort();
      throw controller.signal.reason;
    });
    fetchMock.mockResolvedValue(response);
    await expect(
      client.getLearnedSkillsSnapshot({
        containerId: "c",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
