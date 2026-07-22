import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillSetProjectionV1Schema } from "@copilotkit/intelligence";
import type {
  InstalledSkillSet,
  RegistryProjection,
} from "@copilotkit/intelligence";
import { vi } from "vitest";
import sdkCorpus from "../../intelligence/conformance/registry-sdk-v1.json" with { type: "json" };

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export async function installedSkillSet(
  options: {
    readonly text?: string;
    readonly rawBytes?: Uint8Array;
    readonly count?: number;
    readonly revoked?: boolean;
    readonly freshness?: "fresh" | "cached";
    readonly registryRevision?: string;
    readonly files?: ReadonlyArray<{
      readonly path: string;
      readonly role: "instructions" | "script";
    }>;
  } = {},
): Promise<InstalledSkillSet> {
  const root = await mkdtemp(
    join(tmpdir(), "copilotkit-intelligence-langgraph-"),
  );
  const text = options.text ?? "# Skill\n";
  const count = options.revoked ? 0 : (options.count ?? 1);
  const baseProjection = skillSetProjectionV1Schema.parse(sdkCorpus.projection);
  const baseEntry = baseProjection.entries[0];
  if (!baseEntry)
    throw new Error("Registry SDK fixture must contain one skill");
  const baseFile = baseEntry.manifest.files[0];
  if (!baseFile) throw new Error("Registry SDK fixture must contain SKILL.md");
  const files = (
    options.files ?? [{ path: "SKILL.md", role: "instructions" as const }]
  ).map((file) => ({ ...baseFile, path: file.path, role: file.role }));

  const entries: RegistryProjection["entries"] = [];
  const skills: InstalledSkillSet["skills"] = [];
  for (let position = 0; position < count; position++) {
    const suffix =
      position === 0 ? "999999999999" : position.toString(16).padStart(12, "0");
    const skillId = `99999999-9999-4999-8999-${suffix}`;
    const directory = join(root, `skill-${position}`);
    await mkdir(directory);
    await writeFile(
      join(directory, "SKILL.md"),
      position === 0 && options.rawBytes ? options.rawBytes : text,
    );
    entries.push({
      ...baseEntry,
      skillId,
      position,
      name: position === 0 ? "Safe skill" : `Safe skill ${position}`,
      manifest: { ...baseEntry.manifest, files },
    });
    skills.push({
      skillId,
      versionId: baseEntry.versionId,
      position,
      directory,
    });
  }
  const projection: RegistryProjection = {
    ...baseProjection,
    registryRevision:
      options.registryRevision ?? baseProjection.registryRevision,
    revoked: options.revoked ?? false,
    entries,
  };
  return {
    freshness: options.freshness ?? "fresh",
    directory: root,
    skills,
    projection,
  };
}

export function testClient(get: () => Promise<InstalledSkillSet>) {
  return {
    skills: {
      get: vi.fn(get),
      getCached: vi.fn(get),
    },
  };
}

export class TestCanonicalError extends Error {
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly requestId = "request-telemetry";
  readonly traceId = "trace-telemetry";

  constructor(options: {
    readonly code: string;
    readonly category: string;
    readonly retryable: boolean;
    readonly status?: number;
  }) {
    super(options.code);
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}
