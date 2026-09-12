import { createHash } from "node:crypto";
import type { LearnedSkillsSnapshotResult } from "@copilotkit/runtime/v2";
import { SkillDeliveryError, invalidSnapshot } from "./errors.js";
import {
  MAX_SNAPSHOT_BYTES,
  readArchive,
  safeRelativePath,
} from "./archive.js";

export interface SnapshotFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  /** Absent for supporting resources that cannot be decoded as UTF-8 text. */
  readonly text?: string;
}
export interface SnapshotSkill {
  readonly name: string;
  readonly description: string;
  readonly files: readonly SnapshotFile[];
}
export interface VerifiedSnapshot {
  readonly revision: string;
  readonly etag: string;
  readonly skills: readonly SnapshotSkill[];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function utf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return undefined;
  }
}

/** Validate a replacement fully before it can become an invocation snapshot. */
export async function validateSnapshot(
  response: Extract<LearnedSkillsSnapshotResult, { status: "snapshot" }>,
  signal?: AbortSignal,
): Promise<VerifiedSnapshot> {
  try {
    if (
      !object(response) ||
      !(response.bytes instanceof Uint8Array) ||
      typeof response.revision !== "string" ||
      typeof response.etag !== "string" ||
      typeof response.contentType !== "string"
    )
      throw invalidSnapshot();
    const { revision, etag, contentType } = response;
    if (
      response.status !== "snapshot" ||
      response.bytes.byteLength > MAX_SNAPSHOT_BYTES ||
      contentType.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/zip" ||
      !revision ||
      !/^"[a-f0-9]{64}"$/.test(etag)
    )
      throw invalidSnapshot();
    // Own the bytes before asynchronous decompression so an injected client
    // cannot mutate an in-flight replacement after its digest is checked.
    const bytes = Buffer.from(response.bytes);
    if (`"${sha256(bytes)}"` !== etag) throw invalidSnapshot();
    const archive = await readArchive(bytes, signal);
    const manifestBytes = archive.get("manifest.json");
    if (!manifestBytes) throw invalidSnapshot();
    const decoded = utf8(manifestBytes);
    if (decoded === undefined) throw invalidSnapshot();
    const manifest: unknown = JSON.parse(decoded);
    if (!object(manifest)) throw invalidSnapshot();
    if (
      typeof manifest.schemaVersion === "number" &&
      manifest.schemaVersion !== 1
    )
      throw new SkillDeliveryError("UNSUPPORTED_SERVER", false);
    if (
      manifest.schemaVersion !== 1 ||
      manifest.revision !== revision ||
      !Array.isArray(manifest.skills)
    )
      throw invalidSnapshot();
    const expected = new Set(["manifest.json"]);
    let previousName: string | undefined;
    const skills: SnapshotSkill[] = [];
    for (const skill of manifest.skills) {
      if (
        !object(skill) ||
        typeof skill.name !== "string" ||
        !safeRelativePath(skill.name) ||
        skill.name.includes("/") ||
        (previousName !== undefined &&
          Buffer.compare(Buffer.from(previousName), Buffer.from(skill.name)) >=
            0) ||
        typeof skill.description !== "string" ||
        !Array.isArray(skill.files)
      )
        throw invalidSnapshot();
      previousName = skill.name;
      let previousPath: string | undefined;
      let hasSkill = false;
      const files: SnapshotFile[] = [];
      for (const file of skill.files) {
        if (
          !object(file) ||
          typeof file.path !== "string" ||
          !safeRelativePath(file.path) ||
          (previousPath !== undefined &&
            Buffer.compare(Buffer.from(previousPath), Buffer.from(file.path)) >=
              0) ||
          typeof file.size !== "number" ||
          !Number.isSafeInteger(file.size) ||
          file.size < 0 ||
          typeof file.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(file.sha256)
        )
          throw invalidSnapshot();
        previousPath = file.path;
        const path = `${skill.name}/${file.path}`;
        if (expected.has(path)) throw invalidSnapshot();
        expected.add(path);
        const content = archive.get(path);
        if (
          !content ||
          content.length !== file.size ||
          sha256(content) !== file.sha256
        )
          throw invalidSnapshot();
        const text = utf8(content);
        if (file.path === "SKILL.md") {
          if (text === undefined) throw invalidSnapshot();
          hasSkill = true;
        }
        files.push(
          Object.freeze({
            path: file.path,
            size: file.size,
            sha256: file.sha256,
            ...(text !== undefined ? { text } : {}),
          }),
        );
      }
      if (!hasSkill) throw invalidSnapshot();
      skills.push(
        Object.freeze({
          name: skill.name,
          description: skill.description,
          files: Object.freeze(files),
        }),
      );
    }
    if (
      expected.size !== archive.size ||
      [...archive.keys()].some((path) => !expected.has(path))
    )
      throw invalidSnapshot();
    return Object.freeze({
      revision: revision,
      etag: etag,
      skills: Object.freeze(skills),
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof SkillDeliveryError) throw error;
    throw invalidSnapshot(error);
  }
}
