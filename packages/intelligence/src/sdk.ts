import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  learningContainerIdSchema,
  skillArtifactManifestV1Schema,
  skillSetProjectionV1Schema,
} from "./contracts.js";
import type {
  SkillArtifactManifestV1,
  SkillSetProjectionEntryV1,
  SkillSetProjectionV1,
} from "./contracts.js";
import { learningPlatformErrorResponseV1Schema } from "./errors.js";
import type { LearningPlatformErrorCode } from "./errors.js";

const METADATA_FILE = ".copilotkit-skill-set.json";
const POINTER_FILE = ".copilotkit-current.json";
const SIX_DIGIT_POSITION_LIMIT = 999_999;

export type IntelligenceTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface IntelligenceSdkLimits {
  readonly maxBundleBytes?: number;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxUncompressedBytes?: number;
  readonly maxPathLength?: number;
}

export interface IntelligenceClientOptions {
  readonly baseUrl: string;
  readonly accessToken: string | (() => string | Promise<string>);
  readonly projectNamespace: string;
  readonly cacheRoot: string;
  readonly transport?: IntelligenceTransport;
  readonly limits?: IntelligenceSdkLimits;
}

export interface SkillsGetOptions {
  readonly learningContainerId: string;
}

export type RegistryProjectionEntry = SkillSetProjectionEntryV1;

export type RegistryProjection = SkillSetProjectionV1;

export interface InstalledSkill {
  readonly skillId: string;
  readonly versionId: string;
  readonly position: number;
  readonly directory: string;
}

export interface InstalledSkillSet {
  readonly freshness: "fresh" | "cached";
  readonly projection: RegistryProjection;
  readonly directory: string;
  readonly skills: InstalledSkill[];
}

type ErrorCategory =
  | "validation"
  | "auth"
  | "permission"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "internal"
  | "dependency";

/** Typed canonical SDK failure. No SDK operation returns a fallback sentinel. */
export class IntelligenceSdkError extends Error {
  readonly code: LearningPlatformErrorCode;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly status?: number;

  constructor(options: {
    message: string;
    code: LearningPlatformErrorCode;
    category: ErrorCategory;
    retryable: boolean;
    requestId?: string;
    traceId?: string;
    status?: number;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "IntelligenceSdkError";
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.status = options.status;
  }
}

interface ResolvedLimits {
  maxBundleBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxUncompressedBytes: number;
  maxPathLength: number;
}

interface CachePointer {
  schemaVersion: 1;
  skillSetHash: string;
  etag: string;
  projection: RegistryProjection;
}

interface CachedSkillMetadata {
  skillId: string;
  versionId: string;
  position: number;
  rootDirectory: string;
  manifest: SkillArtifactManifestV1;
}

interface CacheMetadata {
  schemaVersion: 1;
  projectNamespaceSha256: string;
  projection: RegistryProjection;
  skills: CachedSkillMetadata[];
}

interface ZipEntry {
  path: string;
  mode: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  directory: boolean;
}

const DEFAULT_LIMITS: ResolvedLimits = {
  maxBundleBytes: 50 * 1024 * 1024,
  maxFiles: 1_000,
  maxFileBytes: 10 * 1024 * 1024,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxPathLength: 512,
};

function sdkError(
  message: string,
  code: LearningPlatformErrorCode = "LEARNING_SDK_CACHE_CORRUPT",
  cause?: unknown,
): IntelligenceSdkError {
  return new IntelligenceSdkError({
    message,
    code,
    category:
      code === "LEARNING_BLOB_INTEGRITY_FAILURE" ? "validation" : "internal",
    retryable: false,
    cause,
  });
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function manifestHash(manifest: SkillArtifactManifestV1): string {
  const { manifestSha256: _manifestSha256, ...hashable } = manifest;
  return sha256(stableJson(hashable));
}

function assertSafeRelativePath(path: string, maxLength: number): void {
  if (
    path.length === 0 ||
    path.length > maxLength ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/u.test(path) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw sdkError(
      `Unsafe artifact path: ${JSON.stringify(path)}`,
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }
}

function parseZip(bytes: Uint8Array, limits: ResolvedLimits): ZipEntry[] {
  if (bytes.byteLength > limits.maxBundleBytes) {
    throw sdkError(
      "Bundle exceeds the configured byte limit",
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  const scanStart = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= scanStart; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) {
    throw sdkError(
      "Bundle is not a valid ZIP archive",
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (
    entryCount > limits.maxFiles + 1 ||
    centralOffset + centralSize > endOffset ||
    centralOffset > bytes.byteLength
  ) {
    throw sdkError(
      "Invalid or oversized ZIP directory",
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const collisionKeys = new Set<string>();
  let totalSize = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    if (
      cursor + 46 > bytes.byteLength ||
      view.getUint32(cursor, true) !== 0x02014b50
    ) {
      throw sdkError(
        "Malformed ZIP central directory",
        "LEARNING_BLOB_INTEGRITY_FAILURE",
      );
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const mode = view.getUint32(cursor + 38, true) >>> 16;
    const localOffset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.byteLength || (flags & 1) !== 0) {
      throw sdkError(
        "Encrypted or malformed ZIP entries are forbidden",
        "LEARNING_BLOB_INTEGRITY_FAILURE",
      );
    }
    let path: string;
    try {
      path = decoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
    } catch (error) {
      throw sdkError(
        "ZIP paths must be valid UTF-8",
        "LEARNING_BLOB_INTEGRITY_FAILURE",
        error,
      );
    }
    const directory = path.endsWith("/");
    const checkedPath = directory ? path.slice(0, -1) : path;
    assertSafeRelativePath(checkedPath, limits.maxPathLength);
    const fileType = mode & 0o170000;
    if (
      fileType === 0o120000 ||
      (!directory && fileType !== 0 && fileType !== 0o100000)
    ) {
      throw sdkError(
        "Links and special files are forbidden in skill bundles",
        "LEARNING_BLOB_INTEGRITY_FAILURE",
      );
    }
    const collisionKey = checkedPath
      .normalize("NFC")
      .toLocaleLowerCase("en-US");
    if (collisionKeys.has(collisionKey)) {
      throw sdkError(
        "ZIP path collision detected",
        "LEARNING_BLOB_INTEGRITY_FAILURE",
      );
    }
    collisionKeys.add(collisionKey);
    if (!directory) {
      if (uncompressedSize > limits.maxFileBytes) {
        throw sdkError(
          "Bundle file exceeds the configured byte limit",
          "LEARNING_BLOB_INTEGRITY_FAILURE",
        );
      }
      totalSize += uncompressedSize;
      if (totalSize > limits.maxUncompressedBytes) {
        throw sdkError(
          "Bundle expands beyond the configured byte limit",
          "LEARNING_BLOB_INTEGRITY_FAILURE",
        );
      }
    }
    entries.push({
      path,
      mode,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localOffset,
      directory,
    });
    cursor = next;
  }
  if (entries.filter((entry) => !entry.directory).length > limits.maxFiles) {
    throw sdkError(
      "Bundle contains too many files",
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }
  return entries;
}

function extractEntry(
  archive: Uint8Array,
  entry: ZipEntry,
  limits: ResolvedLimits,
): Uint8Array {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  if (
    entry.localOffset + 30 > archive.byteLength ||
    view.getUint32(entry.localOffset, true) !== 0x04034b50
  ) {
    throw sdkError(
      "Malformed ZIP local entry",
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.byteLength) {
    throw sdkError("Truncated ZIP entry", "LEARNING_BLOB_INTEGRITY_FAILURE");
  }
  const compressed = archive.subarray(dataStart, dataEnd);
  let output: Uint8Array;
  if (entry.compressionMethod === 0) {
    output = compressed;
  } else if (entry.compressionMethod === 8) {
    try {
      output = inflateRawSync(compressed, {
        maxOutputLength: limits.maxFileBytes,
      });
    } catch (error) {
      throw sdkError(
        "Invalid compressed ZIP entry",
        "LEARNING_BLOB_INTEGRITY_FAILURE",
        error,
      );
    }
  } else {
    throw sdkError(
      "Unsupported ZIP compression method",
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }
  if (output.byteLength !== entry.uncompressedSize) {
    throw sdkError(
      "ZIP entry length mismatch",
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }
  return output;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw sdkError(
      `Invalid cache JSON at ${path}`,
      "LEARNING_SDK_CACHE_CORRUPT",
      error,
    );
  }
}

function parseProjection(
  value: unknown,
  learningContainerId: string,
): RegistryProjection {
  const parsed = skillSetProjectionV1Schema.safeParse(value);
  if (!parsed.success) {
    throw sdkError(
      "Registry returned an invalid canonical projection",
      "LEARNING_SDK_CACHE_CORRUPT",
      parsed.error,
    );
  }
  if (parsed.data.learningContainerId !== learningContainerId) {
    throw sdkError(
      "Registry projection belongs to a different learning container",
    );
  }
  if (parsed.data.revoked && parsed.data.entries.length > 0) {
    throw sdkError("A revoked projection must be empty");
  }
  const seenSkills = new Set<string>();
  for (const [index, entry] of parsed.data.entries.entries()) {
    if (
      entry.position !== index ||
      entry.position > SIX_DIGIT_POSITION_LIMIT ||
      seenSkills.has(entry.skillId)
    ) {
      throw sdkError("Registry projection has invalid ordered skill positions");
    }
    seenSkills.add(entry.skillId);
  }
  return parsed.data;
}

function parseManifest(
  entry: RegistryProjectionEntry,
): SkillArtifactManifestV1 {
  const manifest = entry.manifest;
  if (
    manifest.bundleSha256 !== entry.bundleSha256 ||
    manifest.bundleByteLength !== entry.bundleByteLength ||
    manifest.manifestSha256 !== entry.manifestSha256 ||
    manifestHash(manifest) !== manifest.manifestSha256
  ) {
    throw sdkError(
      "Artifact manifest integrity mismatch",
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }
  const collisionKeys = new Set<string>();
  for (const file of manifest.files) {
    assertSafeRelativePath(file.path, DEFAULT_LIMITS.maxPathLength);
    const key = file.path.normalize("NFC").toLocaleLowerCase("en-US");
    if (collisionKeys.has(key)) {
      throw sdkError(
        "Artifact manifest path collision",
        "LEARNING_BLOB_INTEGRITY_FAILURE",
      );
    }
    collisionKeys.add(key);
  }
  if (!manifest.files.some((file) => file.path === "SKILL.md")) {
    throw sdkError(
      "Artifact manifest must contain SKILL.md",
      "LEARNING_BLOB_INTEGRITY_FAILURE",
    );
  }
  return manifest;
}

function cachePaths(
  options: IntelligenceClientOptions,
  learningContainerId: string,
) {
  const namespaceHash = sha256(options.projectNamespace);
  const container = join(
    options.cacheRoot,
    "v1",
    namespaceHash,
    learningContainerId,
  );
  return {
    namespaceHash,
    container,
    sets: join(container, "sets"),
    pointer: join(container, POINTER_FILE),
  };
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, relative), {
    withFileTypes: true,
  })) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw sdkError("Cache contains a link or special file");
    }
    if (entry.isDirectory()) result.push(...(await listFiles(root, path)));
    else result.push(path);
  }
  return result.sort();
}

async function verifySetUnchecked(
  directory: string,
  expected: {
    namespaceHash: string;
    learningContainerId: string;
    skillSetHash?: string;
  },
): Promise<CacheMetadata> {
  const raw = await readJson(join(directory, METADATA_FILE));
  if (raw === null || typeof raw !== "object")
    throw sdkError("Invalid cache metadata");
  const metadata = raw as Partial<CacheMetadata>;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.projectNamespaceSha256 !== expected.namespaceHash ||
    !Array.isArray(metadata.skills)
  ) {
    throw sdkError("Cache metadata identity mismatch");
  }
  const projection = parseProjection(
    metadata.projection,
    expected.learningContainerId,
  );
  if (
    expected.skillSetHash &&
    projection.skillSetHash !== expected.skillSetHash
  ) {
    throw sdkError("Cache set hash mismatch");
  }
  if (metadata.skills.length !== projection.entries.length) {
    throw sdkError("Cache skill count mismatch");
  }
  const expectedDiskFiles = [METADATA_FILE];
  for (const [index, skill] of metadata.skills.entries()) {
    const entry = projection.entries[index];
    if (
      !entry ||
      skill.skillId !== entry.skillId ||
      skill.versionId !== entry.versionId ||
      skill.position !== entry.position ||
      typeof skill.rootDirectory !== "string"
    ) {
      throw sdkError("Cache skill metadata mismatch");
    }
    assertSafeRelativePath(skill.rootDirectory, DEFAULT_LIMITS.maxPathLength);
    const manifest = skillArtifactManifestV1Schema.parse(skill.manifest);
    if (
      manifest.manifestSha256 !== entry.manifestSha256 ||
      manifestHash(manifest) !== entry.manifestSha256
    ) {
      throw sdkError("Cached artifact manifest mismatch");
    }
    const skillPrefix = `skills/${String(skill.position).padStart(6, "0")}-${skill.skillId}/${skill.rootDirectory}`;
    for (const file of manifest.files) {
      const path = `${skillPrefix}/${file.path}`;
      const bytes = await readFile(join(directory, path));
      if (
        bytes.byteLength !== file.byteLength ||
        sha256(bytes) !== file.rawSha256
      ) {
        throw sdkError(`Cached artifact failed verification: ${file.path}`);
      }
      expectedDiskFiles.push(path);
    }
  }
  const diskFiles = await listFiles(directory);
  if (stableJson(diskFiles) !== stableJson(expectedDiskFiles.sort())) {
    throw sdkError("Cache contains missing or unexpected files");
  }
  return metadata as CacheMetadata;
}

async function verifySet(
  directory: string,
  expected: {
    namespaceHash: string;
    learningContainerId: string;
    skillSetHash?: string;
  },
): Promise<CacheMetadata> {
  try {
    return await verifySetUnchecked(directory, expected);
  } catch (error) {
    if (error instanceof IntelligenceSdkError) throw error;
    throw sdkError(
      "Cached skill set failed verification",
      "LEARNING_SDK_CACHE_CORRUPT",
      error,
    );
  }
}

async function writePointer(
  path: string,
  pointer: CachePointer,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(pointer)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readPointer(
  path: string,
  learningContainerId: string,
): Promise<CachePointer> {
  const raw = await readJson(path);
  if (
    raw === null ||
    typeof raw !== "object" ||
    (raw as CachePointer).schemaVersion !== 1 ||
    typeof (raw as CachePointer).skillSetHash !== "string" ||
    typeof (raw as CachePointer).etag !== "string" ||
    !("projection" in raw)
  ) {
    throw sdkError("Invalid current cache pointer");
  }
  const pointer = raw as CachePointer;
  const projection = parseProjection(pointer.projection, learningContainerId);
  if (
    pointer.skillSetHash !== projection.skillSetHash ||
    pointer.etag !== projection.etag
  ) {
    throw sdkError("Current cache pointer projection mismatch");
  }
  return { ...pointer, projection };
}

function resultFromMetadata(
  directory: string,
  metadata: CacheMetadata,
  freshness: "fresh" | "cached",
  projection: RegistryProjection = metadata.projection,
): InstalledSkillSet {
  return {
    freshness,
    projection,
    directory,
    skills: metadata.skills.map((skill) => ({
      skillId: skill.skillId,
      versionId: skill.versionId,
      position: skill.position,
      directory: join(
        directory,
        "skills",
        `${String(skill.position).padStart(6, "0")}-${skill.skillId}`,
        skill.rootDirectory,
      ),
    })),
  };
}

function assertProjectionMatchesCachedSkills(
  projection: RegistryProjection,
  metadata: CacheMetadata,
): void {
  if (projection.entries.length !== metadata.skills.length) {
    throw sdkError("Skill-set hash resolved to a different skill count");
  }
  for (const [index, entry] of projection.entries.entries()) {
    const cachedEntry = metadata.projection.entries[index];
    if (
      !cachedEntry ||
      entry.skillId !== cachedEntry.skillId ||
      entry.versionId !== cachedEntry.versionId ||
      entry.position !== cachedEntry.position ||
      entry.bundleSha256 !== cachedEntry.bundleSha256 ||
      entry.manifestSha256 !== cachedEntry.manifestSha256 ||
      entry.bundleByteLength !== cachedEntry.bundleByteLength
    ) {
      throw sdkError(
        "Skill-set hash resolved to different immutable skill content",
      );
    }
  }
}

export class IntelligenceClient {
  readonly skills: {
    get: (options: SkillsGetOptions) => Promise<InstalledSkillSet>;
    getCached: (options: SkillsGetOptions) => Promise<InstalledSkillSet>;
  };
  private readonly options: IntelligenceClientOptions;
  private readonly transport: IntelligenceTransport;
  private readonly limits: ResolvedLimits;

  constructor(options: IntelligenceClientOptions) {
    if (!options.baseUrl || !options.projectNamespace || !options.cacheRoot) {
      throw sdkError(
        "baseUrl, projectNamespace, and cacheRoot are required",
        "LEARNING_REGISTRY_UNRECOVERABLE",
      );
    }
    this.options = options;
    this.transport = options.transport ?? fetch;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw sdkError(
          `Invalid SDK limit: ${name}`,
          "LEARNING_REGISTRY_UNRECOVERABLE",
        );
      }
    }
    this.skills = {
      get: (getOptions) => this.get(getOptions),
      getCached: (getOptions) => this.getCached(getOptions),
    };
  }

  private async token(): Promise<string> {
    const token =
      typeof this.options.accessToken === "function"
        ? await this.options.accessToken()
        : this.options.accessToken;
    if (typeof token !== "string" || token.length === 0) {
      throw new IntelligenceSdkError({
        message: "A non-empty registry access token is required",
        code: "LEARNING_REGISTRY_UNRECOVERABLE",
        category: "auth",
        retryable: false,
      });
    }
    return token;
  }

  private projectionUrl(learningContainerId: string): string {
    return `${this.options.baseUrl.replace(/\/+$/u, "")}/v1/learning-containers/${encodeURIComponent(learningContainerId)}/skills`;
  }

  private bundleUrl(
    learningContainerId: string,
    entry: RegistryProjectionEntry,
  ): string {
    const explicit = entry.downloadUrl;
    if (typeof explicit === "string" && explicit.length > 0) return explicit;
    return `${this.projectionUrl(learningContainerId)}/${encodeURIComponent(entry.skillId)}/versions/${encodeURIComponent(entry.versionId)}/bundle`;
  }

  private async request(url: string, etag?: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.transport(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          Accept: "application/json, application/zip",
          ...(etag ? { "If-None-Match": etag } : {}),
        },
      });
    } catch (error) {
      if (error instanceof IntelligenceSdkError) throw error;
      throw new IntelligenceSdkError({
        message: "Registry transport failed",
        code: "LEARNING_REGISTRY_UNRECOVERABLE",
        category: "dependency",
        retryable: true,
        cause: error,
      });
    }
    return response;
  }

  private async throwResponse(
    response: Response,
    pointerPath: string,
  ): Promise<never> {
    const statusBlocksCache =
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status === 410;
    if (statusBlocksCache) await rm(pointerPath, { force: true });
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new IntelligenceSdkError({
        message: `Registry request failed with HTTP ${response.status}`,
        code: "LEARNING_REGISTRY_UNRECOVERABLE",
        category: "dependency",
        retryable: response.status >= 500,
        status: response.status,
        cause: error,
      });
    }
    const parsed = learningPlatformErrorResponseV1Schema.safeParse(value);
    if (!parsed.success) {
      throw new IntelligenceSdkError({
        message: `Registry returned a non-canonical HTTP ${response.status} error`,
        code: "LEARNING_REGISTRY_UNRECOVERABLE",
        category: "dependency",
        retryable: response.status >= 500,
        status: response.status,
        cause: parsed.error,
      });
    }
    const canonical = parsed.data;
    const blocksCache =
      statusBlocksCache ||
      canonical.error.code === "LEARNING_REGISTRY_UNRECOVERABLE" ||
      canonical.error.code === "LEARNING_CONTAINER_ARCHIVED" ||
      canonical.error.code === "LEARNING_CONTAINER_PROJECT_MISMATCH" ||
      canonical.error.code === "LEARNING_CONTAINER_NOT_FOUND";
    if (blocksCache) await rm(pointerPath, { force: true });
    throw new IntelligenceSdkError({
      message: canonical.error.message,
      code: canonical.error.code,
      category: canonical.error.category,
      retryable: canonical.error.retryable,
      requestId: canonical.requestId,
      traceId: canonical.traceId,
      status: response.status,
    });
  }

  private async current(
    learningContainerId: string,
    freshness: "fresh" | "cached",
  ): Promise<InstalledSkillSet> {
    const paths = cachePaths(this.options, learningContainerId);
    const pointer = await readPointer(paths.pointer, learningContainerId);
    const directory = join(paths.sets, pointer.skillSetHash);
    const metadata = await verifySet(directory, {
      namespaceHash: paths.namespaceHash,
      learningContainerId,
      skillSetHash: pointer.skillSetHash,
    });
    assertProjectionMatchesCachedSkills(pointer.projection, metadata);
    return resultFromMetadata(
      directory,
      metadata,
      freshness,
      pointer.projection,
    );
  }

  private async getCached(
    options: SkillsGetOptions,
  ): Promise<InstalledSkillSet> {
    this.validateLearningContainerId(options.learningContainerId);
    return this.current(options.learningContainerId, "cached");
  }

  private async get(options: SkillsGetOptions): Promise<InstalledSkillSet> {
    this.validateLearningContainerId(options.learningContainerId);
    const paths = cachePaths(this.options, options.learningContainerId);
    let pointer: CachePointer | undefined;
    try {
      pointer = await readPointer(paths.pointer, options.learningContainerId);
    } catch (error) {
      if (!(error instanceof IntelligenceSdkError)) throw error;
      // A missing/corrupt pointer is recoverable only by a fresh unconditional read.
    }

    let response = await this.request(
      this.projectionUrl(options.learningContainerId),
      pointer?.etag,
    );
    if (response.status === 304) {
      try {
        return await this.current(options.learningContainerId, "fresh");
      } catch (error) {
        if (!(error instanceof IntelligenceSdkError)) throw error;
        // A 304 is usable only after full local verification; repair from fresh bytes.
        response = await this.request(
          this.projectionUrl(options.learningContainerId),
        );
        if (response.status === 304) {
          throw sdkError("Unconditional registry refetch returned 304");
        }
      }
    }
    if (response.status !== 200)
      await this.throwResponse(response, paths.pointer);

    let rawProjection: unknown;
    try {
      rawProjection = await response.json();
    } catch (error) {
      throw sdkError(
        "Registry projection is not valid JSON",
        "LEARNING_SDK_CACHE_CORRUPT",
        error,
      );
    }
    const projection = parseProjection(
      rawProjection,
      options.learningContainerId,
    );
    const directory = join(paths.sets, projection.skillSetHash);
    let metadata: CacheMetadata;
    try {
      metadata = await verifySet(directory, {
        namespaceHash: paths.namespaceHash,
        learningContainerId: options.learningContainerId,
        skillSetHash: projection.skillSetHash,
      });
      assertProjectionMatchesCachedSkills(projection, metadata);
    } catch (error) {
      if (!(error instanceof IntelligenceSdkError)) throw error;
      // A missing/corrupt immutable set is repaired from the validated 200 projection.
      metadata = await this.install(paths, projection);
    }
    await writePointer(paths.pointer, {
      schemaVersion: 1,
      skillSetHash: projection.skillSetHash,
      etag: projection.etag,
      projection,
    });
    return resultFromMetadata(directory, metadata, "fresh", projection);
  }

  private validateLearningContainerId(learningContainerId: string): void {
    const parsed = learningContainerIdSchema.safeParse(learningContainerId);
    if (!parsed.success || parsed.data === null) {
      throw new IntelligenceSdkError({
        message: "learningContainerId must be a canonical UUID",
        code: "LEARNING_REGISTRY_UNRECOVERABLE",
        category: "validation",
        retryable: false,
        cause: parsed.error,
      });
    }
  }

  private async install(
    paths: ReturnType<typeof cachePaths>,
    projection: RegistryProjection,
  ): Promise<CacheMetadata> {
    await mkdir(paths.sets, { recursive: true });
    const staging = await mkdtemp(
      join(paths.sets, `.${projection.skillSetHash}.staging-`),
    );
    const skills: CachedSkillMetadata[] = [];
    try {
      for (const entry of projection.entries) {
        const manifest = parseManifest(entry);
        const response = await this.request(
          this.bundleUrl(projection.learningContainerId, entry),
        );
        if (response.status !== 200)
          await this.throwResponse(response, paths.pointer);
        const archive = new Uint8Array(await response.arrayBuffer());
        if (
          archive.byteLength !== entry.bundleByteLength ||
          archive.byteLength !== entry.bundleLocator.byteLength ||
          sha256(archive) !== entry.bundleSha256 ||
          sha256(archive) !== entry.bundleLocator.applicationSha256
        ) {
          throw sdkError(
            "Downloaded bundle integrity mismatch",
            "LEARNING_BLOB_INTEGRITY_FAILURE",
          );
        }
        const zipEntries = parseZip(archive, this.limits);
        const files = zipEntries.filter((zipEntry) => !zipEntry.directory);
        const roots = new Set(
          files.map((zipEntry) => zipEntry.path.split("/")[0]),
        );
        if (
          roots.size !== 1 ||
          files.some((zipEntry) => !zipEntry.path.includes("/"))
        ) {
          throw sdkError(
            "Skill ZIP must contain exactly one root directory",
            "LEARNING_BLOB_INTEGRITY_FAILURE",
          );
        }
        const rootDirectory = [...roots][0]!;
        assertSafeRelativePath(rootDirectory, this.limits.maxPathLength);
        const relativePaths = files.map((zipEntry) =>
          zipEntry.path.slice(rootDirectory.length + 1),
        );
        if (
          stableJson(relativePaths) !==
          stableJson(manifest.files.map((file) => file.path))
        ) {
          throw sdkError(
            "ZIP files do not exactly match manifest order",
            "LEARNING_BLOB_INTEGRITY_FAILURE",
          );
        }
        const destination = join(
          staging,
          "skills",
          `${String(entry.position).padStart(6, "0")}-${entry.skillId}`,
          rootDirectory,
        );
        for (const [index, zipEntry] of files.entries()) {
          const manifestFile = manifest.files[index]!;
          const bytes = extractEntry(archive, zipEntry, this.limits);
          if (
            bytes.byteLength !== manifestFile.byteLength ||
            sha256(bytes) !== manifestFile.rawSha256
          ) {
            throw sdkError(
              `Bundle file failed integrity verification: ${manifestFile.path}`,
              "LEARNING_BLOB_INTEGRITY_FAILURE",
            );
          }
          const output = join(destination, manifestFile.path);
          await mkdir(dirname(output), { recursive: true });
          await writeFile(output, bytes, { flag: "wx", mode: 0o600 });
        }
        skills.push({
          skillId: entry.skillId,
          versionId: entry.versionId,
          position: entry.position,
          rootDirectory,
          manifest,
        });
      }
      const metadata: CacheMetadata = {
        schemaVersion: 1,
        projectNamespaceSha256: paths.namespaceHash,
        projection,
        skills,
      };
      await writeFile(
        join(staging, METADATA_FILE),
        `${JSON.stringify(metadata)}\n`,
        {
          flag: "wx",
          mode: 0o600,
        },
      );
      await verifySet(staging, {
        namespaceHash: paths.namespaceHash,
        learningContainerId: projection.learningContainerId,
        skillSetHash: projection.skillSetHash,
      });
      const target = join(paths.sets, projection.skillSetHash);
      try {
        await rename(staging, target);
      } catch {
        // Rename races are recoverable only after validating or replacing the winner.
        try {
          const winner = await verifySet(target, {
            namespaceHash: paths.namespaceHash,
            learningContainerId: projection.learningContainerId,
            skillSetHash: projection.skillSetHash,
          });
          assertProjectionMatchesCachedSkills(projection, winner);
          return winner;
        } catch (winnerError) {
          if (!(winnerError instanceof IntelligenceSdkError)) throw winnerError;
          const quarantine = `${target}.corrupt-${randomUUID()}`;
          try {
            await rename(target, quarantine);
            await rename(staging, target);
          } catch {
            // Another repair may have won; validate it before reuse.
            const winner = await verifySet(target, {
              namespaceHash: paths.namespaceHash,
              learningContainerId: projection.learningContainerId,
              skillSetHash: projection.skillSetHash,
            });
            await rm(quarantine, { recursive: true, force: true });
            return winner;
          }
          await rm(quarantine, { recursive: true, force: true });
        }
      }
      return await verifySet(target, {
        namespaceHash: paths.namespaceHash,
        learningContainerId: projection.learningContainerId,
        skillSetHash: projection.skillSetHash,
      });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
