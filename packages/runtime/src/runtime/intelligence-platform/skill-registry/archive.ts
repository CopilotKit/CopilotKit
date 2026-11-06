import { Inflate } from "fflate";
import { invalidSnapshot } from "./errors";

/** Internal corruption bounds, including manifest and directory entries. */
export const MAX_ARCHIVE_ENTRIES = 1_000;
export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
// DEFLATE expands at most ~1032:1, so one pushed chunk decodes to ~16 MiB at
// most before the size check below can stop a bomb.
const INFLATE_CHUNK_BYTES = 16 * 1024;

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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

/** Inflate raw DEFLATE data, failing as soon as it decodes past `size` bytes. */
function inflate(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let written = 0;
  const inflater = new Inflate((chunk) => {
    if (written + chunk.length > size) throw invalidSnapshot();
    out.set(chunk, written);
    written += chunk.length;
  });
  let offset = 0;
  do {
    const end = Math.min(offset + INFLATE_CHUNK_BYTES, data.length);
    inflater.push(data.subarray(offset, end), end === data.length);
    offset = end;
  } while (offset < data.length);
  if (written !== size) throw invalidSnapshot();
  return out;
}

/** Find the end-of-central-directory record; its comment must end the file. */
function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const last = bytes.length - END_OF_CENTRAL_DIRECTORY_SIZE;
  for (let offset = last; offset >= Math.max(0, last - 0xffff); offset--) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE)
      continue;
    if (view.getUint16(offset + 20, true) !== last - offset)
      throw invalidSnapshot();
    return offset;
  }
  throw invalidSnapshot();
}

/**
 * Decode only the listed ZIP namespace. No filesystem is involved.
 *
 * Parses the central directory directly and inflates with fflate, so it runs
 * on Node and on edge runtimes alike. ZIP64, multi-disk, and encrypted
 * archives are rejected: snapshots stay far below the ZIP64 limits.
 */
export async function readArchive(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Map<string, Uint8Array>> {
  const throwIfAborted = () => {
    if (signal?.aborted) throw signal.reason ?? invalidSnapshot();
  };
  throwIfAborted();
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    const end = findEndOfCentralDirectory(bytes, view);
    if (view.getUint16(end + 4, true) !== 0) throw invalidSnapshot();
    const entryCount = view.getUint16(end + 10, true);
    if (entryCount > MAX_ARCHIVE_ENTRIES) throw invalidSnapshot();

    const files = new Map<string, Uint8Array>();
    const names = new Set<string>();
    let decodedBytes = 0;
    let header = view.getUint32(end + 16, true);
    for (let index = 0; index < entryCount; index++) {
      throwIfAborted();
      if (
        header + CENTRAL_HEADER_SIZE > bytes.length ||
        view.getUint32(header, true) !== CENTRAL_HEADER_SIGNATURE
      )
        throw invalidSnapshot();
      const generalPurposeBitFlag = view.getUint16(header + 8, true);
      const compressionMethod = view.getUint16(header + 10, true);
      const compressedSize = view.getUint32(header + 20, true);
      const uncompressedSize = view.getUint32(header + 24, true);
      const nameLength = view.getUint16(header + 28, true);
      const extraLength = view.getUint16(header + 30, true);
      const commentLength = view.getUint16(header + 32, true);
      const externalFileAttributes = view.getUint32(header + 38, true);
      const local = view.getUint32(header + 42, true);
      const nameStart = header + CENTRAL_HEADER_SIZE;
      header = nameStart + nameLength + extraLength + commentLength;
      if (header > bytes.length) throw invalidSnapshot();

      // Decode the raw UTF-8 name ourselves instead of normalizing backslashes
      // or consulting alternate Unicode-path extra fields.
      const rawName = bytes.subarray(nameStart, nameStart + nameLength);
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
      const fileType = (externalFileAttributes >>> 16) & 0o170000;
      if (fileType !== 0 && fileType !== (directory ? 0o040000 : 0o100000))
        throw invalidSnapshot();
      // Bit 0 is traditional encryption, bit 6 strong encryption.
      if (generalPurposeBitFlag & 0x41 || ![0, 8].includes(compressionMethod))
        throw invalidSnapshot();
      if (compressionMethod === 0 && compressedSize !== uncompressedSize)
        throw invalidSnapshot();
      decodedBytes += uncompressedSize;
      if (
        decodedBytes > MAX_SNAPSHOT_BYTES ||
        (directory && uncompressedSize !== 0)
      )
        throw invalidSnapshot();
      // Require the central directory and the local entry to name the same
      // bytes. ZIP data descriptors may leave local sizes unset.
      if (
        local + LOCAL_HEADER_SIZE > bytes.length ||
        view.getUint32(local, true) !== LOCAL_HEADER_SIGNATURE
      )
        throw invalidSnapshot();
      if (
        view.getUint16(local + 6, true) !== generalPurposeBitFlag ||
        view.getUint16(local + 8, true) !== compressionMethod
      )
        throw invalidSnapshot();
      const localNameLength = view.getUint16(local + 26, true);
      const localExtraLength = view.getUint16(local + 28, true);
      const localNameStart = local + LOCAL_HEADER_SIZE;
      const dataStart = localNameStart + localNameLength + localExtraLength;
      if (
        dataStart + compressedSize > bytes.length ||
        !equalBytes(
          bytes.subarray(localNameStart, localNameStart + localNameLength),
          rawName,
        )
      )
        throw invalidSnapshot();
      if (
        !(generalPurposeBitFlag & 8) &&
        (view.getUint32(local + 18, true) !== compressedSize ||
          view.getUint32(local + 22, true) !== uncompressedSize)
      )
        throw invalidSnapshot();
      if (directory) continue;

      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      files.set(
        name,
        compressionMethod === 0
          ? data.slice()
          : inflate(data, uncompressedSize),
      );
    }
    throwIfAborted();
    return files;
  } catch (cause) {
    throwIfAborted();
    throw invalidSnapshot(cause);
  }
}
