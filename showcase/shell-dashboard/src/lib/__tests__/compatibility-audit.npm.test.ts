// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { collectNpm } from "../../../scripts/compatibility-audit/registries/npm";
import type { HttpClient } from "../../../scripts/compatibility-audit/types";

const observedAt = "2026-09-30T15:00:00.000Z";

function fixture(body: unknown, status = 200) {
  const get = vi.fn(async (url: string) => ({
    url,
    status,
    observedAt,
    body: JSON.stringify(body) ?? "",
  }));
  return { client: { get } satisfies HttpClient, get };
}

describe("npm release inventory", () => {
  it("uses current version objects as membership, including deprecated releases", async () => {
    const { client, get } = fixture({
      name: "@scope/example",
      versions: {
        "2.0.0": { version: "2.0.0", deprecated: "Use another package" },
        "1.0.0": { version: "1.0.0" },
      },
      time: {
        created: "2020-01-01T00:00:00.000Z",
        modified: "2026-09-29T00:00:00.000Z",
        "0.5.0": "2020-02-01T00:00:00.000Z",
        "1.0.0": "2021-01-01T12:30:00.000Z",
        "2.0.0": "2022-01-01T00:00:00.000Z",
      },
      "dist-tags": { latest: "1.0.0", next: "0.5.0" },
    });

    expect(await collectNpm("@scope/example", client)).toEqual({
      registry: "npm",
      name: "@scope/example",
      sourceUrl: "https://registry.npmjs.org/@scope%2Fexample",
      releases: [
        {
          version: "1.0.0",
          timestamp: "2021-01-01T12:30:00.000Z",
          timestampKind: "published",
          eligible: true,
        },
        {
          version: "2.0.0",
          timestamp: "2022-01-01T00:00:00.000Z",
          timestampKind: "published",
          eligible: true,
        },
      ],
      complete: true,
      diagnostics: [],
    });
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@scope%2Fexample",
      "application/json",
    );
  });

  it.each([
    "bad/name",
    "@scope/../name",
    "@scope/name/extra",
    "https://evil.example/pkg",
    "",
    "UPPERCASE",
  ])(
    "rejects unsafe package identifier %j before requesting metadata",
    async (name) => {
      const { client, get } = fixture({});
      await expect(collectNpm(name, client)).rejects.toThrow(
        /npm package name/,
      );
      expect(get).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      { name: "example", versions: { "1.0.0": {} }, time: {} },
      /publication time/,
    ],
    [
      {
        name: "example",
        versions: { "1.0.0": {} },
        time: { "1.0.0": "not a date" },
      },
      /publication time/,
    ],
    [
      {
        name: "example",
        versions: { "1.0.0": {} },
        time: { "1.0.0": "2020-02-31T00:00:00Z" },
      },
      /publication time/,
    ],
    [{ name: "example", versions: { "1.0.0": {} } }, /publication time/],
    [{ name: "example", versions: {}, time: {} }, /versions/],
    [{ name: "example", versions: [], time: {} }, /versions/],
    [
      {
        name: "example",
        versions: { "1.0.0": null },
        time: { "1.0.0": "2020-01-01T00:00:00Z" },
      },
      /version metadata/,
    ],
    [
      {
        name: "example",
        versions: { "1.0.0": { version: "2.0.0" } },
        time: { "1.0.0": "2020-01-01T00:00:00Z" },
      },
      /version metadata/,
    ],
    [
      {
        name: "other",
        versions: { "1.0.0": {} },
        time: { "1.0.0": "2020-01-01T00:00:00Z" },
      },
      /package identity/,
    ],
    [null, /packument/],
  ] as const)("rejects malformed packument %#", async (body, message) => {
    const { client } = fixture(body);
    await expect(collectNpm("example", client)).rejects.toThrow(message);
  });

  it("rejects a malformed JSON response and an unsuccessful injected response", async () => {
    const client: HttpClient = {
      get: async (url) => ({ url, status: 200, observedAt, body: "{" }),
    };
    await expect(collectNpm("example", client)).rejects.toThrow(/JSON/);

    const { client: missing } = fixture({ error: "not found" }, 404);
    await expect(collectNpm("example", missing)).rejects.toThrow(/HTTP 404/);
  });
});
