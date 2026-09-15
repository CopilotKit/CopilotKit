import { fromBuffer } from "yauzl";
import type { Entry, ZipFile } from "yauzl";
import type { Readable } from "node:stream";
import { invalidSnapshot } from "./errors.js";

/** Internal corruption bounds, including manifest and directory entries. */
export const MAX_ARCHIVE_ENTRIES = 1_000;
export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;

export function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    // Reject control bytes in archive paths, including NUL and DEL.
    // eslint-disable-next-line no-control-regex
    !/[\\\x00-\x1f\x7f]/.test(path) &&
    !/^[a-z]:/i.test(path) &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** Decode only the listed ZIP namespace. No filesystem is involved. */
export function readArchive(
  bytes: Buffer,
  signal?: AbortSignal,
): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    let archive: ZipFile | undefined;
    let stream: Readable | undefined;
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      stream?.destroy();
      archive?.close();
      if (error !== undefined) reject(error);
      else resolve(files);
    };
    const abort = () => finish(signal?.reason ?? invalidSnapshot());
    const files = new Map<string, Buffer>();
    const names = new Set<string>();
    let decodedBytes = 0;
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    fromBuffer(
      bytes,
      {
        lazyEntries: true,
        decodeStrings: false,
        validateEntrySizes: true,
        autoClose: false,
      },
      (error, zip) => {
        if (error) {
          finish(invalidSnapshot(error));
          return;
        }
        archive = zip;
        if (settled) {
          zip.close();
          return;
        }
        zip.on("error", (cause: unknown) => finish(invalidSnapshot(cause)));
        zip.on("end", () => finish());
        if (zip.entryCount > MAX_ARCHIVE_ENTRIES) {
          finish(invalidSnapshot());
          return;
        }
        zip.on("entry", (entry: Entry) => {
          try {
            // decodeStrings:false preserves raw UTF-8 names instead of normalizing
            // backslashes or consulting alternate Unicode-path extra fields.
            const rawName: unknown = entry.fileName;
            if (!Buffer.isBuffer(rawName)) throw invalidSnapshot();
            const name = new TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true,
            }).decode(rawName);
            const directory = name.endsWith("/");
            if (
              !safeRelativePath(directory ? name.slice(0, -1) : name) ||
              names.has(name)
            )
              throw invalidSnapshot();
            names.add(name);
            const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (
              fileType !== 0 &&
              fileType !== (directory ? 0o040000 : 0o100000)
            )
              throw invalidSnapshot();
            if (
              entry.isEncrypted() ||
              ![0, 8].includes(entry.compressionMethod)
            )
              throw invalidSnapshot();
            if (
              !Number.isSafeInteger(entry.uncompressedSize) ||
              entry.uncompressedSize < 0
            )
              throw invalidSnapshot();
            decodedBytes += entry.uncompressedSize;
            if (
              decodedBytes > MAX_SNAPSHOT_BYTES ||
              (directory && entry.uncompressedSize !== 0)
            )
              throw invalidSnapshot();
            // Require the central directory and the local entry to name the same
            // bytes. ZIP data descriptors may leave local sizes unset.
            const local = entry.relativeOffsetOfLocalHeader;
            if (
              local < 0 ||
              local + 30 > bytes.length ||
              bytes.readUInt32LE(local) !== 0x04034b50
            )
              throw invalidSnapshot();
            if (
              bytes.readUInt16LE(local + 6) !== entry.generalPurposeBitFlag ||
              bytes.readUInt16LE(local + 8) !== entry.compressionMethod
            )
              throw invalidSnapshot();
            const localNameLength = bytes.readUInt16LE(local + 26);
            const localExtraLength = bytes.readUInt16LE(local + 28);
            const dataStart = local + 30 + localNameLength + localExtraLength;
            if (
              dataStart + entry.compressedSize > bytes.length ||
              !bytes
                .subarray(local + 30, local + 30 + localNameLength)
                .equals(rawName)
            )
              throw invalidSnapshot();
            if (
              !(entry.generalPurposeBitFlag & 8) &&
              (bytes.readUInt32LE(local + 18) !== entry.compressedSize ||
                bytes.readUInt32LE(local + 22) !== entry.uncompressedSize)
            )
              throw invalidSnapshot();
            if (directory) {
              zip.readEntry();
              return;
            }
            zip.openReadStream(entry, (readError, readStream) => {
              if (readError) {
                finish(invalidSnapshot(readError));
                return;
              }
              stream = readStream;
              if (settled) {
                readStream.destroy();
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              readStream.on("error", (cause: unknown) =>
                finish(invalidSnapshot(cause)),
              );
              readStream.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (
                  size > entry.uncompressedSize ||
                  size > MAX_SNAPSHOT_BYTES
                ) {
                  finish(invalidSnapshot());
                  return;
                }
                chunks.push(chunk);
              });
              readStream.on("end", () => {
                if (settled) return;
                if (size !== entry.uncompressedSize) {
                  finish(invalidSnapshot());
                  return;
                }
                files.set(name, Buffer.concat(chunks, size));
                stream = undefined;
                zip.readEntry();
              });
            });
          } catch (cause) {
            finish(invalidSnapshot(cause));
          }
        });
        zip.readEntry();
      },
    );
  });
}
