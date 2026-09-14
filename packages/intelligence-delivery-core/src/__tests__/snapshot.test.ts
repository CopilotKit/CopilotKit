import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import fixtures from "../../conformance/snapshots.v1.json";
import { validateSnapshot } from "../snapshot.js";

export function fixtureResponse(name = "text-skill") {
  const fixture = fixtures.cases.find((item) => item.name === name)!;
  return {
    status: "snapshot" as const,
    bytes: new Uint8Array(Buffer.from(fixture.archiveBase64, "base64")),
    revision: fixture.revision,
    etag: fixture.etag,
    contentType: "application/zip",
  };
}

describe("language-neutral snapshot conformance", () => {
  for (const fixture of fixtures.cases) {
    it(fixture.name, async () => {
      const result = validateSnapshot(fixtureResponse(fixture.name));
      if (fixture.expected === "valid") {
        const snapshot = await result;
        expect(snapshot.revision).toBe(fixture.revision);
        expect(snapshot.etag).toBe(fixture.etag);
        expect(Object.isFrozen(snapshot)).toBe(true);
      } else {
        await expect(result).rejects.toMatchObject({ code: fixture.expected });
      }
    });
  }

  it("returns immutable decoded content and exact supporting membership", async () => {
    const snapshot = await validateSnapshot(fixtureResponse());
    expect(snapshot.skills).toEqual([
      {
        name: "refund-policy",
        description: "Use when handling refunds.",
        files: [
          expect.objectContaining({
            path: "SKILL.md",
            text: "# Refund policy\nUse the published refund policy.\n",
          }),
          expect.objectContaining({
            path: "reference.txt",
            text: "Refunds are available for 30 days.\n",
          }),
        ],
      },
    ]);
    expect(Object.isFrozen(snapshot.skills)).toBe(true);
    expect(Object.isFrozen(snapshot.skills[0])).toBe(true);
    expect(Object.isFrozen(snapshot.skills[0].files)).toBe(true);
    expect(Object.isFrozen(snapshot.skills[0].files[0])).toBe(true);
  });

  it("does not expose unreadable supporting bytes as model text", async () => {
    const snapshot = await validateSnapshot(fixtureResponse("binary-resource"));
    expect(
      snapshot.skills[0].files.find(
        (file: { path: string }) => file.path === "resource.bin",
      ).text,
    ).toBeUndefined();
  });

  it("rejects archive bytes that do not match the complete archive ETag", async () => {
    await expect(
      validateSnapshot({ ...fixtureResponse(), etag: `"${"0".repeat(64)}"` }),
    ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it("rejects a corrupt ZIP even when its ETag matches", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(
      validateSnapshot({
        ...fixtureResponse(),
        bytes,
        etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it("returns a typed error for a malformed null response", async () => {
    await expect(
      validateSnapshot(null as unknown as ReturnType<typeof fixtureResponse>),
    ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it("owns archive bytes before asynchronous parsing", async () => {
    const response = fixtureResponse();
    const pending = validateSnapshot(response);
    response.bytes.fill(0);
    const snapshot = await pending;
    expect(
      snapshot.skills[0].files.find((file) => file.path === "SKILL.md")?.text,
    ).toContain("# Refund policy");
  });

  it("captures response metadata before asynchronous parsing", async () => {
    const response = fixtureResponse();
    const etag = response.etag;
    const pending = validateSnapshot(response);
    response.etag = `"${"0".repeat(64)}"`;
    expect((await pending).etag).toBe(etag);
  });

  it("preserves the exact decoded text including a UTF-8 BOM", async () => {
    const content = new TextEncoder().encode("\ufeff# Skill");
    const manifest = {
      schemaVersion: 1,
      revision: "r1",
      skills: [
        {
          name: "skill",
          description: "description",
          files: [
            {
              path: "SKILL.md",
              size: content.length,
              sha256: createHash("sha256").update(content).digest("hex"),
            },
          ],
        },
      ],
    };
    const bytes = zipSync({
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      "skill/SKILL.md": content,
    });
    const snapshot = await validateSnapshot({
      ...fixtureResponse(),
      bytes,
      etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
    });
    expect(snapshot.skills[0].files[0].text).toBe("\ufeff# Skill");
  });

  it("does not normalize a BOM-prefixed archive filename into manifest.json", async () => {
    const bytes = zipSync({
      "\ufeffmanifest.json": new TextEncoder().encode(
        JSON.stringify({ schemaVersion: 1, revision: "r1", skills: [] }),
      ),
    });
    await expect(
      validateSnapshot({
        ...fixtureResponse(),
        bytes,
        etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it("rejects more than 1000 archive entries before installing content", async () => {
    const fileBytes = new TextEncoder().encode("text");
    const files = [
      "SKILL.md",
      ...Array.from(
        { length: 999 },
        (_, i) => `file-${String(i).padStart(4, "0")}.txt`,
      ),
    ];
    const manifest = {
      schemaVersion: 1,
      revision: "r1",
      skills: [
        {
          name: "skill",
          description: "description",
          files: files.map((path) => ({
            path,
            size: fileBytes.length,
            sha256: createHash("sha256").update(fileBytes).digest("hex"),
          })),
        },
      ],
    };
    const bytes = zipSync({
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      ...Object.fromEntries(files.map((path) => [`skill/${path}`, fileBytes])),
    });
    await expect(
      validateSnapshot({
        ...fixtureResponse(),
        bytes,
        etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it("rejects a compressed archive declaring more than 32 MiB decoded content", async () => {
    const content = new Uint8Array(32 * 1024 * 1024 + 1).fill(65);
    const manifest = {
      schemaVersion: 1,
      revision: "r1",
      skills: [
        {
          name: "skill",
          description: "description",
          files: [
            {
              path: "SKILL.md",
              size: content.length,
              sha256: createHash("sha256").update(content).digest("hex"),
            },
          ],
        },
      ],
    };
    const bytes = zipSync({
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      "skill/SKILL.md": content,
    });
    await expect(
      validateSnapshot({
        ...fixtureResponse(),
        bytes,
        etag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it("rejects archives over the 32 MiB compressed limit", async () => {
    await expect(
      validateSnapshot({
        ...fixtureResponse(),
        bytes: new Uint8Array(32 * 1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ code: "INVALID_SNAPSHOT" });
  });
});
