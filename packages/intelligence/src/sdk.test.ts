import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelligenceClient, IntelligenceSdkError } from "./sdk.js";
import type { IntelligenceTransport } from "./sdk.js";

const CONTAINER = "55555555-5555-4555-8555-555555555555";
const SKILL = "99999999-9999-4999-8999-999999999999";
const VERSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-07-16T18:00:00.000Z";
const roots: string[] = [];

interface GoldenRegistryFixture {
  identity: {
    baseUrl: string;
    projectNamespace: string;
    learningContainerId: string;
  };
  http: {
    projectionPath: string;
    authorization: string;
    ifNoneMatch: string;
  };
  bundle: {
    base64: string;
    fileContents: string;
  };
  projection: Record<string, unknown>;
  errors: Record<
    "canonicalConflict" | "canonicalDenial" | "unknownCode" | "malformed",
    {
      status: number;
      body: Record<string, unknown>;
      invalidatesCache?: boolean;
    }
  >;
  expectations: {
    initialFreshness: "fresh";
    validated304Freshness: "fresh";
    explicitCacheFreshness: "cached";
    nonCanonicalErrorCode: string;
  };
}

async function goldenRegistryFixture(): Promise<GoldenRegistryFixture> {
  return JSON.parse(
    await readFile(
      new URL("../conformance/registry-sdk-v1.json", import.meta.url),
      "utf8",
    ),
  ) as GoldenRegistryFixture;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "intelligence-sdk-"));
  roots.push(root);
  return root;
}

function sha(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  path: string;
  bytes: Uint8Array;
  mode?: number;
  declaredSize?: number;
}

function zip(entries: ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const size = entry.declaredSize ?? entry.bytes.byteLength;
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.byteLength + entry.bytes.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.bytes.byteLength, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.byteLength);
    locals.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x0314, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.bytes.byteLength, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.byteLength, true);
    cv.setUint32(38, (entry.mode ?? 0o100644) << 16, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.byteLength;
  }
  const centralSize = centrals.reduce(
    (sum, entry) => sum + entry.byteLength,
    0,
  );
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + end.byteLength);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    result.set(part, cursor);
    cursor += part.byteLength;
  }
  return result;
}

function fixture(
  overrides: {
    files?: ZipEntry[];
    revoked?: boolean;
    empty?: boolean;
    manifestFiles?: Array<{ path: string; bytes: Uint8Array }>;
  } = {},
) {
  const bytes = new TextEncoder().encode("# Skill\n");
  const files = overrides.files ?? [{ path: "safe-skill/SKILL.md", bytes }];
  const archive = zip(files);
  const listed = overrides.manifestFiles ?? [
    { path: "SKILL.md", bytes: files[0]?.bytes ?? bytes },
  ];
  const manifestWithoutHash = {
    manifestVersion: 1 as const,
    agentSkillsProfile: "agentskills:v1",
    files: listed.map((file) => ({
      path: file.path,
      role: file.path === "SKILL.md" ? "instructions" : "resource",
      mediaType: "text/markdown",
      byteLength: file.bytes.byteLength,
      rawSha256: sha(file.bytes),
    })),
    bundleSha256: sha(archive),
    bundleByteLength: archive.byteLength,
    provenance: {},
  };
  const manifest = {
    ...manifestWithoutHash,
    manifestSha256: sha(stable(manifestWithoutHash)),
  };
  const entry = {
    skillId: SKILL,
    versionId: VERSION,
    position: 0,
    name: "Safe skill",
    description: null,
    bundleLocator: {
      schemaVersion: 1,
      backendId: "primary",
      provider: "awsS3",
      resource: "skill-bundles",
      key: "objects/safe.zip",
      providerVersion: null,
      etag: null,
      applicationSha256: sha(archive),
      providerChecksum: null,
      byteLength: archive.byteLength,
      contentType: "application/zip",
    },
    bundleSha256: sha(archive),
    manifestSha256: manifest.manifestSha256,
    bundleByteLength: archive.byteLength,
    approvalMethod: "manual",
    manifest,
    futureEntryField: "preserved",
  };
  const projection = {
    schemaVersion: 1,
    learningContainerId: CONTAINER,
    registryRevision: "revision-1",
    skillSetHash: sha(overrides.empty ? "empty" : archive),
    etag: '"registry-1"',
    entries: overrides.empty ? [] : [entry],
    publishedAt: NOW,
    revoked: overrides.revoked ?? false,
    futureProjectionField: { preserved: true },
  };
  return { archive, manifest, projection };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sequence(
  ...responses: Array<Response | Error>
): IntelligenceTransport {
  const queue = [...responses];
  return vi.fn(async () => {
    const response = queue.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("Unexpected transport request");
    return response;
  });
}

describe("IntelligenceClient registry SDK", () => {
  it("consumes the shared canonical registry golden response", async () => {
    const golden = await goldenRegistryFixture();
    const root = await cacheRoot();
    const archive = Buffer.from(golden.bundle.base64, "base64");
    const transport = sequence(
      jsonResponse(golden.projection),
      new Response(archive),
    );
    const client = new IntelligenceClient({
      baseUrl: golden.identity.baseUrl,
      accessToken: "secret-token",
      projectNamespace: golden.identity.projectNamespace,
      cacheRoot: root,
      transport,
    });

    const result = await client.skills.get({
      learningContainerId: golden.identity.learningContainerId,
    });

    expect(result.freshness).toBe(golden.expectations.initialFreshness);
    expect(
      await readFile(join(result.skills[0]!.directory, "SKILL.md"), "utf8"),
    ).toBe(golden.bundle.fileContents);
    expect(transport).toHaveBeenNthCalledWith(
      1,
      `${golden.identity.baseUrl}${golden.http.projectionPath}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: golden.http.authorization,
        }),
      }),
    );
  });

  it("uses the golden ETag only after verifying the cached set", async () => {
    const golden = await goldenRegistryFixture();
    const root = await cacheRoot();
    const options = {
      baseUrl: golden.identity.baseUrl,
      accessToken: "secret-token",
      projectNamespace: golden.identity.projectNamespace,
      cacheRoot: root,
    };
    await new IntelligenceClient({
      ...options,
      transport: sequence(
        jsonResponse(golden.projection),
        new Response(Buffer.from(golden.bundle.base64, "base64")),
      ),
    }).skills.get({ learningContainerId: golden.identity.learningContainerId });
    const transport = sequence(new Response(null, { status: 304 }));

    const result = await new IntelligenceClient({
      ...options,
      transport,
    }).skills.get({ learningContainerId: golden.identity.learningContainerId });

    expect(result.freshness).toBe(golden.expectations.validated304Freshness);
    expect(transport).toHaveBeenCalledWith(
      `${golden.identity.baseUrl}${golden.http.projectionPath}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          "If-None-Match": golden.http.ifNoneMatch,
        }),
      }),
    );
  });

  it("applies the shared golden error and cache-invalidation semantics", async () => {
    const golden = await goldenRegistryFixture();
    const root = await cacheRoot();
    const options = {
      baseUrl: golden.identity.baseUrl,
      accessToken: "secret-token",
      projectNamespace: golden.identity.projectNamespace,
      cacheRoot: root,
    };
    await new IntelligenceClient({
      ...options,
      transport: sequence(
        jsonResponse(golden.projection),
        new Response(Buffer.from(golden.bundle.base64, "base64")),
      ),
    }).skills.get({ learningContainerId: golden.identity.learningContainerId });
    const conflict = golden.errors.canonicalConflict;
    const conflicting = new IntelligenceClient({
      ...options,
      transport: sequence(jsonResponse(conflict.body, conflict.status)),
    });

    await expect(
      conflicting.skills.get({
        learningContainerId: golden.identity.learningContainerId,
      }),
    ).rejects.toMatchObject(conflict.body.error as Record<string, unknown>);
    await expect(
      conflicting.skills.getCached({
        learningContainerId: golden.identity.learningContainerId,
      }),
    ).resolves.toMatchObject({
      freshness: golden.expectations.explicitCacheFreshness,
    });

    const denial = golden.errors.canonicalDenial;
    const denied = new IntelligenceClient({
      ...options,
      transport: sequence(jsonResponse(denial.body, denial.status)),
    });
    await expect(
      denied.skills.get({
        learningContainerId: golden.identity.learningContainerId,
      }),
    ).rejects.toMatchObject(denial.body.error as Record<string, unknown>);
    await expect(
      denied.skills.getCached({
        learningContainerId: golden.identity.learningContainerId,
      }),
    ).rejects.toMatchObject({ code: "LEARNING_SDK_CACHE_CORRUPT" });
  });

  it("maps golden unknown and malformed errors to a fail-loud SDK error", async () => {
    const golden = await goldenRegistryFixture();
    for (const scenario of [
      golden.errors.unknownCode,
      golden.errors.malformed,
    ]) {
      const client = new IntelligenceClient({
        baseUrl: golden.identity.baseUrl,
        accessToken: "secret-token",
        projectNamespace: golden.identity.projectNamespace,
        cacheRoot: await cacheRoot(),
        transport: sequence(jsonResponse(scenario.body, scenario.status)),
      });

      await expect(
        client.skills.get({
          learningContainerId: golden.identity.learningContainerId,
        }),
      ).rejects.toMatchObject({
        code: golden.expectations.nonCanonicalErrorCode,
        category: "dependency",
      });
    }
  });

  it("rejects a non-canonical learning container id before transport", async () => {
    const root = await cacheRoot();
    const transport = vi.fn<IntelligenceTransport>();
    const client = new IntelligenceClient({
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
      transport,
    });

    await expect(
      client.skills.get({ learningContainerId: "not-a-uuid" }),
    ).rejects.toMatchObject({
      code: "LEARNING_REGISTRY_UNRECOVERABLE",
      category: "validation",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a revoked projection that still contains skills", async () => {
    const golden = await goldenRegistryFixture();
    const root = await cacheRoot();
    const archive = Buffer.from(golden.bundle.base64, "base64");
    const client = new IntelligenceClient({
      baseUrl: golden.identity.baseUrl,
      accessToken: "secret-token",
      projectNamespace: golden.identity.projectNamespace,
      cacheRoot: root,
      transport: sequence(
        jsonResponse({ ...golden.projection, revoked: true }),
        new Response(archive),
      ),
    });

    await expect(
      client.skills.get({
        learningContainerId: golden.identity.learningContainerId,
      }),
    ).rejects.toMatchObject({ code: "LEARNING_SDK_CACHE_CORRUPT" });
  });

  it("rejects a projection without its canonical manifest before installation", async () => {
    const golden = await goldenRegistryFixture();
    const root = await cacheRoot();
    const projection = structuredClone(golden.projection) as {
      entries: Array<Record<string, unknown>>;
    };
    projection.entries[0]!.artifactManifest = projection.entries[0]!.manifest;
    delete projection.entries[0]!.manifest;
    const transport = sequence(jsonResponse(projection));
    const client = new IntelligenceClient({
      baseUrl: golden.identity.baseUrl,
      accessToken: "secret-token",
      projectNamespace: golden.identity.projectNamespace,
      cacheRoot: root,
      transport,
    });

    await expect(
      client.skills.get({
        learningContainerId: golden.identity.learningContainerId,
      }),
    ).rejects.toMatchObject({ code: "LEARNING_SDK_CACHE_CORRUPT" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("uses bearer authentication with the fetch transport and preserves loose fields", async () => {
    const root = await cacheRoot();
    const { archive, projection } = fixture();
    const transport = sequence(
      jsonResponse(projection),
      new Response(archive, { status: 200 }),
    );
    const client = new IntelligenceClient({
      baseUrl: "https://registry.example.test/",
      accessToken: async () => "secret-token",
      projectNamespace: "project-a",
      cacheRoot: root,
      transport,
    });

    const result = await client.skills.get({ learningContainerId: CONTAINER });

    expect(result.freshness).toBe("fresh");
    expect(result.projection.futureProjectionField).toEqual({
      preserved: true,
    });
    expect(result.projection.entries[0]?.futureEntryField).toBe("preserved");
    expect(transport).toHaveBeenNthCalledWith(
      1,
      `https://registry.example.test/v1/learning-containers/${CONTAINER}/skills`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
    expect(
      await readFile(join(result.skills[0]!.directory, "SKILL.md"), "utf8"),
    ).toBe("# Skill\n");
  });

  it("fully verifies a 304 cache and unconditionally refetches once when it is corrupt", async () => {
    const root = await cacheRoot();
    const { archive, projection } = fixture();
    const first = new IntelligenceClient({
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
      transport: sequence(jsonResponse(projection), new Response(archive)),
    });
    const installed = await first.skills.get({
      learningContainerId: CONTAINER,
    });
    await writeFile(
      join(installed.skills[0]!.directory, "SKILL.md"),
      "corrupt",
    );
    const transport = sequence(
      new Response(null, { status: 304 }),
      jsonResponse(projection),
      new Response(archive),
    );
    const client = new IntelligenceClient({
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
      transport,
    });

    const repaired = await client.skills.get({
      learningContainerId: CONTAINER,
    });

    expect(transport).toHaveBeenCalledTimes(3);
    expect(
      (transport as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].headers,
    ).toMatchObject({ "If-None-Match": '"registry-1"' });
    expect(
      (transport as ReturnType<typeof vi.fn>).mock.calls[1]?.[1].headers,
    ).not.toHaveProperty("If-None-Match");
    expect(
      await readFile(join(repaired.skills[0]!.directory, "SKILL.md"), "utf8"),
    ).toBe("# Skill\n");
  });

  it("rejects canonical projection mismatches with a typed error", async () => {
    const root = await cacheRoot();
    const { projection } = fixture();
    const client = new IntelligenceClient({
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
      transport: sequence(
        jsonResponse({ ...projection, learningContainerId: SKILL }),
      ),
    });

    await expect(
      client.skills.get({ learningContainerId: CONTAINER }),
    ).rejects.toMatchObject({
      name: "IntelligenceSdkError",
      code: "LEARNING_SDK_CACHE_CORRUPT",
    });
  });

  it.each([
    ["traversal", [{ path: "safe/../SKILL.md", bytes: new Uint8Array() }]],
    ["absolute", [{ path: "/safe/SKILL.md", bytes: new Uint8Array() }]],
    ["backslash", [{ path: "safe\\SKILL.md", bytes: new Uint8Array() }]],
    [
      "link",
      [{ path: "safe/SKILL.md", bytes: new Uint8Array(), mode: 0o120777 }],
    ],
    [
      "case collision",
      [
        { path: "safe/SKILL.md", bytes: new Uint8Array() },
        { path: "safe/skill.md", bytes: new Uint8Array() },
      ],
    ],
  ])("rejects unsafe ZIP %s entries", async (_name, files) => {
    const root = await cacheRoot();
    const { archive, projection } = fixture({ files });
    const client = new IntelligenceClient({
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
      transport: sequence(jsonResponse(projection), new Response(archive)),
    });
    await expect(
      client.skills.get({ learningContainerId: CONTAINER }),
    ).rejects.toBeInstanceOf(IntelligenceSdkError);
  });

  it("enforces archive bounds, manifest order, integrity, and required SKILL.md", async () => {
    const invalidFixtures = [
      {
        value: fixture({
          files: [
            {
              path: "safe/SKILL.md",
              bytes: new Uint8Array(),
              declaredSize: 1_000,
            },
          ],
        }),
        code: "LEARNING_BLOB_INTEGRITY_FAILURE",
      },
      {
        value: fixture({
          files: [
            { path: "safe/a.md", bytes: new TextEncoder().encode("a") },
            {
              path: "safe/SKILL.md",
              bytes: new TextEncoder().encode("# Skill\n"),
            },
          ],
          manifestFiles: [
            {
              path: "SKILL.md",
              bytes: new TextEncoder().encode("# Skill\n"),
            },
            { path: "a.md", bytes: new TextEncoder().encode("a") },
          ],
        }),
        code: "LEARNING_BLOB_INTEGRITY_FAILURE",
      },
      {
        value: fixture({
          files: [{ path: "safe/README.md", bytes: new Uint8Array() }],
          manifestFiles: [{ path: "README.md", bytes: new Uint8Array() }],
        }),
        code: "LEARNING_SDK_CACHE_CORRUPT",
      },
    ] as const;
    for (const { value, code } of invalidFixtures) {
      const root = await cacheRoot();
      const client = new IntelligenceClient({
        baseUrl: "https://registry.test",
        accessToken: "token",
        projectNamespace: "project-a",
        cacheRoot: root,
        limits: { maxUncompressedBytes: 100 },
        transport: sequence(
          jsonResponse(value.projection),
          new Response(value.archive),
        ),
      });
      await expect(
        client.skills.get({ learningContainerId: CONTAINER }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("atomically converges concurrent installers on one verified set", async () => {
    const root = await cacheRoot();
    const { archive, projection } = fixture();
    let releases = 0;
    const transport: IntelligenceTransport = vi.fn(async (url) => {
      if (url.endsWith("/skills")) return jsonResponse(projection);
      releases += 1;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, releases === 1 ? 10 : 0),
      );
      return new Response(archive);
    });
    const options = {
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
      transport,
    };

    const [left, right] = await Promise.all([
      new IntelligenceClient(options).skills.get({
        learningContainerId: CONTAINER,
      }),
      new IntelligenceClient(options).skills.get({
        learningContainerId: CONTAINER,
      }),
    ]);

    expect(left.directory).toBe(right.directory);
    await expect(stat(left.directory)).resolves.toMatchObject({});
    expect(
      await readFile(
        join(left.directory, ".copilotkit-skill-set.json"),
        "utf8",
      ),
    ).toContain(projection.skillSetHash);
  });

  it("reuses a skill set across registry revisions because revision is not in the cache key", async () => {
    const root = await cacheRoot();
    const { archive, projection } = fixture();
    const options = {
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
    };
    const initial = await new IntelligenceClient({
      ...options,
      transport: sequence(jsonResponse(projection), new Response(archive)),
    }).skills.get({ learningContainerId: CONTAINER });
    const nextProjection = {
      ...projection,
      registryRevision: "revision-2",
      etag: '"registry-2"',
      publishedAt: "2026-07-16T19:00:00.000Z",
    };
    const transport = sequence(jsonResponse(nextProjection));
    const client = new IntelligenceClient({ ...options, transport });

    const next = await client.skills.get({ learningContainerId: CONTAINER });
    const cached = await client.skills.getCached({
      learningContainerId: CONTAINER,
    });

    expect(next.directory).toBe(initial.directory);
    expect(next.projection.registryRevision).toBe("revision-2");
    expect(cached.projection.registryRevision).toBe("revision-2");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["empty", fixture({ empty: true })],
    ["revoked", fixture({ empty: true, revoked: true })],
  ])("installs a valid %s projection", async (_name, value) => {
    const root = await cacheRoot();
    const client = new IntelligenceClient({
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
      transport: sequence(jsonResponse(value.projection)),
    });
    const result = await client.skills.get({ learningContainerId: CONTAINER });
    expect(result.skills).toEqual([]);
    expect(result.projection.revoked).toBe(value.projection.revoked);
  });

  it("never lets get fall back but lets explicit getCached return validated cached freshness", async () => {
    const root = await cacheRoot();
    const { archive, projection } = fixture();
    const options = {
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
    };
    await new IntelligenceClient({
      ...options,
      transport: sequence(jsonResponse(projection), new Response(archive)),
    }).skills.get({ learningContainerId: CONTAINER });
    const offline = new IntelligenceClient({
      ...options,
      transport: sequence(new Error("offline")),
    });

    await expect(
      offline.skills.get({ learningContainerId: CONTAINER }),
    ).rejects.toMatchObject({ name: "IntelligenceSdkError" });
    await expect(
      offline.skills.getCached({ learningContainerId: CONTAINER }),
    ).resolves.toMatchObject({ freshness: "cached" });
  });

  it.each(["missing-file", "invalid-manifest"])(
    "returns a typed cache-corruption error for %s",
    async (corruption) => {
      const root = await cacheRoot();
      const { archive, projection } = fixture();
      const client = new IntelligenceClient({
        baseUrl: "https://registry.test",
        accessToken: "token",
        projectNamespace: "project-a",
        cacheRoot: root,
        transport: sequence(jsonResponse(projection), new Response(archive)),
      });
      const installed = await client.skills.get({
        learningContainerId: CONTAINER,
      });
      if (corruption === "missing-file") {
        await rm(join(installed.skills[0]!.directory, "SKILL.md"));
      } else {
        const metadataPath = join(
          installed.directory,
          ".copilotkit-skill-set.json",
        );
        const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
        metadata.skills[0].manifest = null;
        await writeFile(metadataPath, JSON.stringify(metadata));
      }

      await expect(
        client.skills.getCached({ learningContainerId: CONTAINER }),
      ).rejects.toMatchObject({
        name: "IntelligenceSdkError",
        code: "LEARNING_SDK_CACHE_CORRUPT",
      });
    },
  );

  it("surfaces canonical errors and known denial blocks explicit cache use", async () => {
    const root = await cacheRoot();
    const { archive, projection } = fixture();
    const options = {
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
    };
    await new IntelligenceClient({
      ...options,
      transport: sequence(jsonResponse(projection), new Response(archive)),
    }).skills.get({ learningContainerId: CONTAINER });
    const denied = new IntelligenceClient({
      ...options,
      transport: sequence(
        jsonResponse(
          {
            error: {
              code: "LEARNING_REGISTRY_UNRECOVERABLE",
              message: "Registry denied consumption.",
              category: "permission",
              retryable: false,
            },
            requestId: "request-1",
            traceId: "trace-1",
          },
          403,
        ),
      ),
    });

    await expect(
      denied.skills.get({ learningContainerId: CONTAINER }),
    ).rejects.toMatchObject({
      code: "LEARNING_REGISTRY_UNRECOVERABLE",
      requestId: "request-1",
      traceId: "trace-1",
    });
    await expect(
      denied.skills.getCached({ learningContainerId: CONTAINER }),
    ).rejects.toMatchObject({ code: "LEARNING_SDK_CACHE_CORRUPT" });
  });

  it("blocks cached consumption for a non-canonical authentication denial", async () => {
    const root = await cacheRoot();
    const { archive, projection } = fixture();
    const options = {
      baseUrl: "https://registry.test",
      accessToken: "token",
      projectNamespace: "project-a",
      cacheRoot: root,
    };
    await new IntelligenceClient({
      ...options,
      transport: sequence(jsonResponse(projection), new Response(archive)),
    }).skills.get({ learningContainerId: CONTAINER });
    const denied = new IntelligenceClient({
      ...options,
      transport: sequence(new Response("denied", { status: 401 })),
    });

    await expect(
      denied.skills.get({ learningContainerId: CONTAINER }),
    ).rejects.toBeInstanceOf(IntelligenceSdkError);
    await expect(
      denied.skills.getCached({ learningContainerId: CONTAINER }),
    ).rejects.toMatchObject({ code: "LEARNING_SDK_CACHE_CORRUPT" });
  });
});
