import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import type { Zippable } from "fflate";
import fixtures from "../../../../../../intelligence-delivery-core/conformance/snapshots.v1.json";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_SNAPSHOT_BYTES,
  readArchive,
} from "../archive";
import { validateSnapshot } from "../snapshot";

const text = (value: string) => new TextEncoder().encode(value);

/** Offsets of each central directory header and its local header. */
function headers(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const out: { central: number; local: number }[] = [];
  let offset = view.getUint32(end + 16, true);
  for (let index = 0; index < count; index++) {
    out.push({ central: offset, local: view.getUint32(offset + 42, true) });
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return { view, end, entries: out };
}

/** Copy an archive and change it in place. */
function mutate(
  files: Zippable,
  change: (archive: ReturnType<typeof headers>, bytes: Uint8Array) => void,
): Uint8Array {
  const bytes = zipSync(files);
  change(headers(bytes), bytes);
  return bytes;
}

async function rejects(bytes: Uint8Array) {
  await expect(readArchive(bytes)).rejects.toMatchObject({
    code: "INVALID_SNAPSHOT",
  });
}

describe("readArchive", () => {
  it("reads stored and deflated members and skips directories", async () => {
    const big = text("Refunds are available for 30 days.\n".repeat(200));
    const files = await readArchive(
      zipSync({
        "manifest.json": [text("{}"), { level: 0 }],
        "skill/": new Uint8Array(0),
        "skill/SKILL.md": [big, { level: 9 }],
      }),
    );
    expect([...files.keys()]).toEqual(["manifest.json", "skill/SKILL.md"]);
    expect(files.get("manifest.json")).toEqual(text("{}"));
    expect(files.get("skill/SKILL.md")).toEqual(big);
  });

  it("reads members that use data descriptors", async () => {
    const fixture = fixtures.cases.find(
      (item) => item.name === "deflated-data-descriptors",
    )!;
    const files = await readArchive(
      new Uint8Array(Buffer.from(fixture.archiveBase64, "base64")),
    );
    expect(files.has("manifest.json")).toBe(true);
  });

  it("accepts an archive comment", async () => {
    const bytes = zipSync({ "a.txt": text("a") });
    const withComment = new Uint8Array(bytes.length + 3);
    withComment.set(bytes);
    withComment.set(text("abc"), bytes.length);
    new DataView(withComment.buffer).setUint16(bytes.length - 2, 3, true);
    expect((await readArchive(withComment)).get("a.txt")).toEqual(text("a"));
  });

  it("rejects bytes that are not a ZIP archive", async () => {
    await rejects(new Uint8Array([1, 2, 3]));
    await rejects(new Uint8Array(1024));
  });

  it("rejects a truncated archive", async () => {
    const bytes = zipSync({ "a.txt": text("hello") });
    await rejects(bytes.subarray(0, bytes.length - 1));
    await rejects(bytes.subarray(10));
  });

  it("rejects a comment length that does not end the file", async () => {
    await rejects(
      mutate({ "a.txt": text("a") }, ({ view, end }) =>
        view.setUint16(end + 20, 5, true),
      ),
    );
  });

  it("rejects multi-disk archives", async () => {
    await rejects(
      mutate({ "a.txt": text("a") }, ({ view, end }) =>
        view.setUint16(end + 4, 1, true),
      ),
    );
  });

  it(`rejects more than ${MAX_ARCHIVE_ENTRIES} entries`, async () => {
    const files: Zippable = {};
    for (let index = 0; index <= MAX_ARCHIVE_ENTRIES; index++)
      files[`file-${index}.txt`] = new Uint8Array(0);
    await rejects(zipSync(files));
  });

  it("rejects unsafe member paths", async () => {
    for (const name of [
      "../escape.txt",
      "skill/../escape.txt",
      "/absolute.txt",
      "skill\\file.txt",
      "C:file.txt",
      "skill/./file.txt",
      "skill//file.txt",
      "bad\u0000name.txt",
      "bad\u007fname.txt",
    ])
      await rejects(zipSync({ [name]: text("x") }));
  });

  it("rejects a member name that is not valid UTF-8", async () => {
    await rejects(
      mutate({ "a.txt": text("a") }, ({ entries: [entry] }, bytes) => {
        bytes[entry.central + 46] = 0xff;
        bytes[entry.local + 30] = 0xff;
      }),
    );
  });

  it("rejects duplicate member names", async () => {
    await rejects(
      mutate(
        { "a.txt": text("a"), "b.txt": text("b") },
        ({ entries }, bytes) => {
          for (const entry of entries) {
            bytes[entry.central + 46] = 0x61;
            bytes[entry.local + 30] = 0x61;
          }
        },
      ),
    );
  });

  it("rejects symlinks and other non-regular file types", async () => {
    for (const mode of [0o120777, 0o060644]) {
      await rejects(
        mutate({ "a.txt": text("a") }, ({ view, entries: [entry] }) =>
          view.setUint32(entry.central + 38, (mode << 16) >>> 0, true),
        ),
      );
    }
  });

  it("accepts a regular file mode", async () => {
    const bytes = mutate({ "a.txt": text("a") }, ({ view, entries: [entry] }) =>
      view.setUint32(entry.central + 38, (0o100644 << 16) >>> 0, true),
    );
    expect((await readArchive(bytes)).get("a.txt")).toEqual(text("a"));
  });

  it("rejects encrypted members", async () => {
    for (const flag of [0x1, 0x40]) {
      await rejects(
        mutate({ "a.txt": text("a") }, ({ view, entries: [entry] }) => {
          view.setUint16(entry.central + 8, flag, true);
          view.setUint16(entry.local + 6, flag, true);
        }),
      );
    }
  });

  it("rejects unsupported compression methods", async () => {
    await rejects(
      mutate({ "a.txt": text("a") }, ({ view, entries: [entry] }) => {
        view.setUint16(entry.central + 10, 12, true);
        view.setUint16(entry.local + 8, 12, true);
      }),
    );
  });

  it("rejects a directory with content", async () => {
    await rejects(zipSync({ "skill/": text("x") }));
  });

  it("rejects a stored member whose sizes disagree", async () => {
    await rejects(
      mutate({ "a.txt": [text("abc"), { level: 0 }] }, ({ view, entries }) =>
        view.setUint32(entries[0].central + 24, 2, true),
      ),
    );
  });

  it(`rejects more than ${MAX_SNAPSHOT_BYTES} declared decoded bytes`, async () => {
    await rejects(
      mutate({ "a.txt": text("a") }, ({ view, entries: [entry] }) => {
        view.setUint32(entry.central + 24, MAX_SNAPSHOT_BYTES + 1, true);
        view.setUint32(entry.local + 22, MAX_SNAPSHOT_BYTES + 1, true);
      }),
    );
  });

  it("rejects a deflated member that decodes past its declared size", async () => {
    // A small zip bomb: 4 MiB of zeros that claims to decode to 10 bytes.
    const bomb = new Uint8Array(4 * 1024 * 1024);
    await rejects(
      mutate(
        { "a.txt": [bomb, { level: 9 }] },
        ({ view, entries: [entry] }) => {
          view.setUint32(entry.central + 24, 10, true);
          view.setUint32(entry.local + 22, 10, true);
        },
      ),
    );
  });

  it("rejects a deflated member that decodes short of its declared size", async () => {
    await rejects(
      mutate(
        { "a.txt": [text("hello"), { level: 9 }] },
        ({ view, entries: [entry] }) => {
          view.setUint32(entry.central + 24, 6, true);
          view.setUint32(entry.local + 22, 6, true);
        },
      ),
    );
  });

  it("rejects corrupt deflate data", async () => {
    await rejects(
      mutate(
        { "a.txt": [text("hello world"), { level: 9 }] },
        ({ view, entries: [entry] }, bytes) => {
          const start =
            entry.local +
            30 +
            view.getUint16(entry.local + 26, true) +
            view.getUint16(entry.local + 28, true);
          bytes.fill(
            0xff,
            start,
            start + view.getUint32(entry.central + 20, true),
          );
        },
      ),
    );
  });

  it("rejects a local header that does not match the central directory", async () => {
    const changes: ((
      view: DataView,
      local: number,
      bytes: Uint8Array,
    ) => void)[] = [
      (view, local) => view.setUint32(local, 0, true),
      (view, local) => view.setUint16(local + 6, 0x800, true),
      (view, local) => view.setUint16(local + 8, 8, true),
      (_view, local, bytes) => {
        bytes[local + 30] = 0x62;
      },
      (view, local) => view.setUint32(local + 18, 99, true),
      (view, local) => view.setUint32(local + 22, 99, true),
      (view, local) => view.setUint16(local + 28, 0xffff, true),
    ];
    for (const change of changes) {
      await rejects(
        mutate(
          { "a.txt": [text("abc"), { level: 0 }] },
          ({ view, entries: [entry] }, bytes) =>
            change(view, entry.local, bytes),
        ),
      );
    }
  });

  it("rejects a local header offset outside the archive", async () => {
    await rejects(
      mutate({ "a.txt": text("a") }, ({ view, entries: [entry] }) =>
        view.setUint32(entry.central + 42, 0xffffffff, true),
      ),
    );
  });

  it("rejects with the abort reason when already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);
    await expect(
      readArchive(zipSync({ "a.txt": text("a") }), controller.signal),
    ).rejects.toBe(reason);
  });
});

describe("validateSnapshot conformance", () => {
  for (const fixture of fixtures.cases) {
    it(fixture.name, async () => {
      const result = validateSnapshot({
        status: "snapshot",
        bytes: new Uint8Array(Buffer.from(fixture.archiveBase64, "base64")),
        revision: fixture.revision,
        etag: fixture.etag,
        contentType: "application/zip",
      });
      if (fixture.expected === "valid") {
        expect((await result).revision).toBe(fixture.revision);
      } else {
        await expect(result).rejects.toMatchObject({ code: fixture.expected });
      }
    });
  }
});
