// @vitest-environment node

import { describe, expect, it } from "vitest";
import { collectPypi } from "../../../scripts/compatibility-audit/registries/pypi";
import type {
  HttpClient,
  RawResponse,
} from "../../../scripts/compatibility-audit/types";

const indexUrl = "https://pypi.org/simple/my-project/";
const observedAt = "2026-09-30T12:00:00Z";

function fixture(responses: Record<string, unknown>): {
  client: HttpClient;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async get(url, accept): Promise<RawResponse> {
        calls.push(`${url} ${accept ?? ""}`);
        if (!Object.prototype.hasOwnProperty.call(responses, url))
          throw new Error(`Unexpected request ${url}`);
        return {
          url,
          status: 200,
          observedAt,
          body: JSON.stringify(responses[url]),
        };
      },
    },
  };
}

function index(versions: string[], files: object[], apiVersion = "1.1") {
  return {
    meta: { "api-version": apiVersion },
    name: "My.Project",
    versions,
    files,
  };
}

function wheel(
  version: string,
  upload: string | undefined,
  yanked: boolean | string = false,
) {
  return {
    filename: `my_project-${version}-py3-none-any.whl`,
    ...(upload === undefined ? {} : { "upload-time": upload }),
    yanked,
  };
}

describe("PyPI inventory", () => {
  it("canonicalizes names, deduplicates versions, and dates releases by the first unyanked file", async () => {
    const { client, calls } = fixture({
      [indexUrl]: index(
        ["1.0", "1.1", "1.0", "1.2"],
        [
          wheel("1.0", "2026-01-01T00:00:00Z", true),
          wheel("1.0", "2026-02-01T00:00:00Z"),
          {
            filename: "my-project-1.0.tar.gz",
            "upload-time": "2026-03-01T00:00:00Z",
          },
          wheel("1.1", "2026-01-02T00:00:00Z", "bad build"),
        ],
      ),
    });
    const result = await collectPypi("My_.Project", client);
    expect(result).toEqual({
      registry: "pypi",
      name: "my-project",
      sourceUrl: indexUrl,
      releases: [
        {
          version: "1.0",
          timestamp: "2026-02-01T00:00:00Z",
          timestampKind: "published",
          eligible: true,
        },
        {
          version: "1.1",
          timestamp: null,
          timestampKind: "published",
          eligible: false,
        },
        {
          version: "1.2",
          timestamp: null,
          timestampKind: "published",
          eligible: false,
        },
      ],
      complete: true,
      diagnostics: [],
    });
    expect(calls).toEqual([`${indexUrl} application/vnd.pypi.simple.v1+json`]);
  });

  it("uses version JSON when an unyanked file lacks an Index upload time", async () => {
    const detailUrl = "https://pypi.org/pypi/my-project/2.0/json";
    const { client, calls } = fixture({
      [indexUrl]: index(["2.0"], [wheel("2.0", undefined)]),
      [detailUrl]: {
        info: { version: "2.0" },
        urls: [
          { upload_time_iso_8601: "2026-01-01T00:00:00Z", yanked: true },
          { upload_time_iso_8601: "2026-02-01T00:00:00Z", yanked: false },
        ],
      },
    });
    expect((await collectPypi("my-project", client)).releases).toEqual([
      {
        version: "2.0",
        timestamp: "2026-02-01T00:00:00Z",
        timestampKind: "published",
        eligible: true,
      },
    ]);
    expect(calls).toEqual([
      `${indexUrl} application/vnd.pypi.simple.v1+json`,
      `${detailUrl} application/json`,
    ]);
  });

  it("uses project JSON for an older Index without versions, including empty releases", async () => {
    const projectUrl = "https://pypi.org/pypi/my-project/json";
    const detailUrl = "https://pypi.org/pypi/my-project/3.0/json";
    const { client, calls } = fixture({
      [indexUrl]: {
        meta: { "api-version": "1.0" },
        files: [wheel("3.0", undefined)],
      },
      [projectUrl]: { releases: { "3.0": [{}], "3.1": [] } },
      [detailUrl]: {
        info: { version: "3.0" },
        urls: [{ upload_time_iso_8601: "2026-04-01T00:00:00Z", yanked: false }],
      },
    });
    const result = await collectPypi("MY_PROJECT", client);
    expect(
      result.releases.map(({ version, eligible }) => [version, eligible]),
    ).toEqual([
      ["3.0", true],
      ["3.1", false],
    ]);
    expect(calls.map((item) => item.split(" ")[0])).toEqual([
      indexUrl,
      projectUrl,
      detailUrl,
    ]);
  });

  it("does not request known-empty releases while legacy file membership is unresolved", async () => {
    const projectUrl = "https://pypi.org/pypi/my-project/json";
    const detailUrl = "https://pypi.org/pypi/my-project/3.0/json";
    const { client, calls } = fixture({
      [indexUrl]: {
        meta: { "api-version": "1.0" },
        files: [{ filename: "legacy-file.egg" }],
      },
      [projectUrl]: { releases: { "3.1": [], "3.0": [{}] } },
      [detailUrl]: {
        info: { version: "3.0" },
        urls: [
          {
            filename: "legacy-file.egg",
            upload_time_iso_8601: "2026-04-01T00:00:00Z",
            yanked: false,
          },
        ],
      },
    });
    const result = await collectPypi("my-project", client);
    expect(result.complete).toBe(true);
    expect(result.releases).toEqual([
      {
        version: "3.1",
        timestamp: null,
        timestampKind: "published",
        eligible: false,
      },
      {
        version: "3.0",
        timestamp: "2026-04-01T00:00:00Z",
        timestampKind: "published",
        eligible: true,
      },
    ]);
    expect(calls.map((item) => item.split(" ")[0])).toEqual([
      indexUrl,
      projectUrl,
      detailUrl,
    ]);
  });

  it("marks a release incomplete if neither endpoint establishes every usable upload time", async () => {
    const detailUrl = "https://pypi.org/pypi/my-project/4.0/json";
    const { client } = fixture({
      [indexUrl]: index(["4.0"], [wheel("4.0", undefined)]),
      [detailUrl]: { info: { version: "4.0" }, urls: [{ yanked: false }] },
    });
    const result = await collectPypi("my-project", client);
    expect(result.complete).toBe(false);
    expect(result.releases[0]).toMatchObject({
      eligible: true,
      timestamp: null,
    });
    expect(result.diagnostics).toEqual([
      expect.stringMatching(/without an upload time/),
    ]);
  });

  it("resolves an unfamiliar legacy filename through release JSON", async () => {
    const detailUrl = "https://pypi.org/pypi/my-project/5.0/json";
    const { client } = fixture({
      [indexUrl]: index(
        ["5.0"],
        [
          {
            filename: "legacy-file.egg",
            "upload-time": "2026-01-01T00:00:00Z",
          },
        ],
      ),
      [detailUrl]: {
        info: { version: "5.0" },
        urls: [
          {
            filename: "legacy-file.egg",
            upload_time_iso_8601: "2026-01-01T00:00:00Z",
            yanked: false,
          },
        ],
      },
    });
    const result = await collectPypi("my-project", client);
    expect(result.complete).toBe(true);
    expect(result.releases[0]).toMatchObject({
      eligible: true,
      timestamp: "2026-01-01T00:00:00Z",
    });
  });

  it("reports an unresolved legacy file instead of declaring a complete inventory", async () => {
    const detailUrl = "https://pypi.org/pypi/my-project/5.0/json";
    const { client } = fixture({
      [indexUrl]: index(
        ["5.0"],
        [{ filename: "mystery.egg", "upload-time": "2026-01-01T00:00:00Z" }],
      ),
      [detailUrl]: { info: { version: "5.0" }, urls: [] },
    });
    const result = await collectPypi("my-project", client);
    expect(result.complete).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.stringMatching(/unresolved release membership/),
    ]);
  });

  it("rejects invalid names, mismatched releases, and malformed metadata", async () => {
    const { client } = fixture({
      [indexUrl]: index(["1.0"], [wheel("1.0", "2026-02-30T00:00:00Z")]),
    });
    await expect(collectPypi("../my-project", client)).rejects.toThrow(
      /name is invalid/,
    );
    await expect(collectPypi("my-project", client)).rejects.toThrow(
      /invalid upload time/,
    );

    const detailUrl = "https://pypi.org/pypi/my-project/1.0/json";
    const mismatched = fixture({
      [indexUrl]: index(["1.0"], [wheel("1.0", undefined)]),
      [detailUrl]: { info: { version: "9.9" }, urls: [] },
    });
    await expect(collectPypi("my-project", mismatched.client)).rejects.toThrow(
      /does not match/,
    );
  });
});
