// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { collectMaven } from "../../../scripts/compatibility-audit/registries/maven";
import type { HttpClient } from "../../../scripts/compatibility-audit/types";

const name = "org.springframework.ai:spring-ai-bom";
const metadataUrl =
  "https://repo1.maven.org/maven2/org/springframework/ai/spring-ai-bom/maven-metadata.xml";
const observedAt = "2026-09-30T15:00:00.000Z";

function metadata(versionList: string[], extra = "") {
  return `<metadata><groupId>org.springframework.ai</groupId><artifactId>spring-ai-bom</artifactId><versioning><latest>99.0.0</latest><versions>${versionList.map((version) => `<version>${version}</version>`).join("")}</versions><lastUpdated>20990101000000</lastUpdated></versioning>${extra}</metadata>`;
}

function fixture(
  xml: string,
  pages: { numFound: number; start?: number; docs: unknown[] }[],
) {
  const get = vi.fn(async (url: string) => {
    const index =
      url === metadataUrl ? -1 : Number(new URL(url).searchParams.get("start"));
    return {
      url,
      status: 200,
      observedAt,
      body: index === -1 ? xml : JSON.stringify({ response: pages[index] }),
    };
  });
  return { client: { get } satisfies HttpClient, get };
}

function row(
  v: string,
  timestamp: number | null,
  group = "org.springframework.ai",
  artifact = "spring-ai-bom",
) {
  return { g: group, a: artifact, v, timestamp };
}

describe("Maven Central release inventory", () => {
  it("joins metadata to GAV dates and preserves their last-updated meaning", async () => {
    const { client, get } = fixture(
      metadata(["1.0.0-RC1", "1.0.0", "1.1.0-M1"]),
      [
        {
          numFound: 3,
          docs: [
            row("1.0.0", Date.parse("2026-09-29T12:00:00Z")),
            row("1.0.0-RC1", Date.parse("2026-09-01T00:00:00Z")),
            row("1.1.0-M1", Date.parse("2026-10-01T00:00:00Z")),
          ],
        },
      ],
    );
    expect(await collectMaven(name, client)).toEqual({
      registry: "maven",
      name,
      sourceUrl: metadataUrl,
      releases: [
        {
          version: "1.0.0",
          timestamp: "2026-09-29T12:00:00.000Z",
          timestampKind: "registry-last-updated",
          eligible: true,
        },
        {
          version: "1.0.0-RC1",
          timestamp: "2026-09-01T00:00:00.000Z",
          timestampKind: "registry-last-updated",
          eligible: true,
        },
        {
          version: "1.1.0-M1",
          timestamp: "2026-10-01T00:00:00.000Z",
          timestampKind: "registry-last-updated",
          eligible: true,
        },
      ],
      complete: true,
      diagnostics: [],
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(1, metadataUrl, "application/xml");
    const search = new URL(get.mock.calls[1][0]);
    expect(search.origin + search.pathname).toBe(
      "https://central.sonatype.com/solrsearch/select",
    );
    expect(Object.fromEntries(search.searchParams)).toEqual({
      q: 'g:"org.springframework.ai" AND a:"spring-ai-bom"',
      core: "gav",
      rows: "200",
      start: "0",
      wt: "json",
    });
    // Collection retains dates on either side of a cutoff; selection belongs
    // to the evaluator and must never use metadata's global lastUpdated.
  });

  it("fetches every Search page by zero-based page index", async () => {
    const releases = Array.from({ length: 201 }, (_, i) => `${i + 1}.0.0`);
    const docs = releases.map((version, index) =>
      row(version, Date.parse("2026-09-01T00:00:00Z") + index),
    );
    const { client, get } = fixture(metadata(releases), [
      { numFound: 201, start: 0, docs: docs.slice(0, 200) },
      { numFound: 201, start: 1, docs: docs.slice(200) },
    ]);
    const inventory = await collectMaven(name, client);
    expect(inventory.complete).toBe(true);
    expect(inventory.releases).toHaveLength(201);
    expect(get).toHaveBeenCalledTimes(3);
    expect(new URL(get.mock.calls[2][0]).searchParams.get("start")).toBe("1");
  });

  it("rejects a response start that uses a row offset instead of the requested page", async () => {
    const releases = Array.from({ length: 201 }, (_, i) => `${i + 1}.0.0`);
    const docs = releases.map((version) => row(version, 1));
    const { client } = fixture(metadata(releases), [
      { numFound: 201, start: 0, docs: docs.slice(0, 200) },
      { numFound: 201, start: 200, docs: docs.slice(200) },
    ]);
    await expect(collectMaven(name, client)).rejects.toThrow(
      /pagination metadata is invalid/,
    );
  });

  it("marks a short non-final page incomplete and stops pagination", async () => {
    const starts: string[] = [];
    const client: HttpClient = {
      get: async (url) => {
        if (url === metadataUrl)
          return {
            url,
            status: 200,
            observedAt,
            body: metadata(["1.0.0", "2.0.0"]),
          };
        const start = new URL(url).searchParams.get("start")!;
        starts.push(start);
        const docs = start === "0" ? [row("1.0.0", 1)] : [row("2.0.0", 2)];
        return {
          url,
          status: 200,
          observedAt,
          body: JSON.stringify({ response: { numFound: 2, docs } }),
        };
      },
    };
    const inventory = await collectMaven(name, client);
    expect(inventory.complete).toBe(false);
    expect(inventory.diagnostics.join(" ")).toMatch(/ended before numFound/);
    expect(starts).toEqual(["0"]);
  });

  it("marks Search lag and missing dates incomplete without using global metadata dates", async () => {
    const { client } = fixture(metadata(["1.0.0", "2.0.0", "3.0.0"]), [
      {
        numFound: 3,
        docs: [
          row("1.0.0", Date.parse("2026-01-01T00:00:00Z")),
          row("2.0.0", null),
          row("4.0.0", Date.parse("2026-02-01T00:00:00Z")),
        ],
      },
    ]);
    const inventory = await collectMaven(name, client);
    expect(inventory.complete).toBe(false);
    expect(
      inventory.releases.find((item) => item.version === "2.0.0")?.timestamp,
    ).toBeNull();
    expect(
      inventory.releases.find((item) => item.version === "3.0.0")?.timestamp,
    ).toBeNull();
    expect(inventory.diagnostics.join(" ")).toMatch(/no date.*2\.0\.0/);
    expect(inventory.diagnostics.join(" ")).toMatch(
      /missing metadata version 3\.0\.0/,
    );
    expect(inventory.diagnostics.join(" ")).toMatch(/absent from metadata/);
  });

  it("marks premature empty and duplicate pages incomplete", async () => {
    const { client } = fixture(metadata(["1.0.0", "2.0.0"]), [
      { numFound: 2, docs: [] },
    ]);
    expect((await collectMaven(name, client)).complete).toBe(false);
    const duplicate = fixture(metadata(["1.0.0", "2.0.0"]), [
      { numFound: 2, docs: [row("1.0.0", 1), row("1.0.0", 1)] },
    ]);
    expect(
      (await collectMaven(name, duplicate.client)).diagnostics.join(" "),
    ).toMatch(/repeats version/);
  });

  it("marks a changing result count or oversized result set incomplete", async () => {
    const releases = Array.from({ length: 201 }, (_, i) => `${i + 1}.0.0`);
    const docs = releases.map((version) => row(version, 1));
    const changed = fixture(metadata(releases), [
      { numFound: 201, docs: docs.slice(0, 200) },
      { numFound: 202, docs: docs.slice(200) },
    ]);
    expect(
      (await collectMaven(name, changed.client)).diagnostics.join(" "),
    ).toMatch(/numFound changed/);
    const oversized = fixture(metadata(["1.0.0"]), [
      { numFound: 20_001, docs: [] },
    ]);
    expect(
      (await collectMaven(name, oversized.client)).diagnostics.join(" "),
    ).toMatch(/row limit/);
    expect(oversized.get).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed, namespaced, duplicate and conflicting metadata", async () => {
    const cases = [
      ["<metadata><groupId>x</groupId>", /unclosed|unexpected|XML/i],
      [
        metadata(["1.0.0"]).replace(
          "<metadata>",
          '<metadata xmlns="urn:unexpected">',
        ),
        /namespace/,
      ],
      [metadata(["1.0.0", "1.0.0"]), /duplicate versions/],
      [
        metadata(["1.0.0"]).replace(
          "spring-ai-bom</artifactId>",
          "other</artifactId>",
        ),
        /coordinates/,
      ],
    ] as const;
    for (const [xml, error] of cases) {
      await expect(collectMaven(name, fixture(xml, []).client)).rejects.toThrow(
        error,
      );
    }
  });

  it("rejects conflicting GAV coordinates, malformed JSON and invalid timestamps", async () => {
    for (const docs of [[row("1.0.0", 1, "other")], [row("1.0.0", -1)]]) {
      await expect(
        collectMaven(
          name,
          fixture(metadata(["1.0.0"]), [{ numFound: 1, docs }]).client,
        ),
      ).rejects.toThrow(/coordinates|timestamp/);
    }
    const client: HttpClient = {
      get: async (url) => ({
        url,
        status: 200,
        observedAt,
        body: url === metadataUrl ? metadata(["1.0.0"]) : "{",
      }),
    };
    await expect(collectMaven(name, client)).rejects.toThrow(/JSON/);
    const conflicting = fixture(metadata(["1.0.0"]), [
      { numFound: 2, docs: [row("1.0.0", 1), row("1.0.0", 2)] },
    ]);
    await expect(collectMaven(name, conflicting.client)).rejects.toThrow(
      /conflicting dates/,
    );
  });

  it.each(["", "a", "a:b:c", "../a:b", "a:../b", "a:b/evil", "a:b..c"])(
    "rejects invalid coordinate %j before HTTP",
    async (coordinate) => {
      const { client, get } = fixture(metadata(["1.0.0"]), []);
      await expect(collectMaven(coordinate, client)).rejects.toThrow(
        /coordinates/,
      );
      expect(get).not.toHaveBeenCalled();
    },
  );
});
