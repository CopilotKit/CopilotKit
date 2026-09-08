import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";

interface PreviewOptions {
  root: string;
  directory: string;
  packedTarballs: ReadonlyMap<string, string>;
  fetch?: typeof fetch;
}

function document(contents: string) {
  const parsed = parseDocument(contents);
  if (parsed.errors.length) throw parsed.errors[0];
  return parsed;
}

function entries(value: unknown): [string, unknown][] {
  if (value === undefined) return [];
  if (!isMap(value)) throw new Error("expected a dependency mapping");
  return value.items.map(({ key, value: item }) => {
    if (!isScalar(key) || typeof key.value !== "string") {
      throw new Error("dependency names must be strings");
    }
    return [key.value, isScalar(item) ? item.value : item];
  });
}

/**
 * Fresh packed consumers have no workspace lockfile to authorize upstream URL
 * dependencies. Reuse the root's exact locked AG-UI previews as file overrides
 * without weakening block-exotic-subdeps or modifying the downloaded archives.
 * Registry dependencies continue to resolve normally.
 */
export async function materializeAgUiPreviews({
  root,
  directory,
  packedTarballs,
  fetch: download = fetch,
}: PreviewOptions): Promise<Map<string, string>> {
  const rootManifest = document(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const pins = new Map<string, string>();
  const commits = new Set<string>();
  for (const [name, pin] of entries(
    rootManifest.getIn(["pnpm", "overrides"]),
  )) {
    // Parent selectors are not independent artifacts.
    if (!/^@ag-ui\/[a-z0-9-]+$/.test(name)) continue;
    if (typeof pin !== "string" || !pin.includes("pkg.pr.new")) continue;
    const prefix = `https://pkg.pr.new/ag-ui-protocol/ag-ui/${name}@`;
    if (
      !pin.startsWith(prefix) ||
      !/^[a-f0-9]{40}$/.test(pin.slice(prefix.length))
    ) {
      throw new Error(`unsupported AG-UI preview pin: ${name}@${String(pin)}`);
    }
    pins.set(name, pin);
    commits.add(pin.slice(prefix.length));
  }
  if (!pins.size) return new Map();
  if (commits.size !== 1)
    throw new Error("AG-UI previews must use the same commit");

  // In particular, --artifacts must not silently replace an older packed
  // Angular preview with the current checkout's different preview.
  for (const [owner, tarball] of packedTarballs) {
    const packed = document(
      execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
        encoding: "utf8",
      }),
    );
    for (const field of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const [name, pin] of entries(packed.get(field))) {
        if (
          name.startsWith("@ag-ui/") &&
          typeof pin === "string" &&
          pin.includes("pkg.pr.new") &&
          pins.get(name) !== pin
        ) {
          throw new Error(
            `packed ${owner} preview ${name}@${pin} does not match the root pin`,
          );
        }
      }
    }
  }

  const lock = document(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
  const previews = [...pins].map(([name, url]) => {
    const key = ["packages", `${name}@${url}`];
    const integrity: unknown = lock.getIn([...key, "resolution", "integrity"]);
    const version: unknown = lock.getIn([...key, "version"]);
    if (
      lock.getIn([...key, "resolution", "tarball"]) !== url ||
      typeof integrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity) ||
      typeof version !== "string"
    ) {
      throw new Error(`missing locked SHA512 resolution for ${name}@${url}`);
    }
    return { name, url, integrity, version };
  });

  const tarballs = new Map<string, string>();
  for (const { name, url, integrity, version } of previews) {
    const response = await download(url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        `AG-UI preview download failed: ${url} (${response.status})`,
      );
    if (
      response.headers.get("x-commit-key") !==
      `ag-ui-protocol:ag-ui:${url.slice(-40)}`
    ) {
      throw new Error(`AG-UI preview commit mismatch for ${name}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      `sha512-${createHash("sha512").update(bytes).digest("base64")}` !==
      integrity
    ) {
      throw new Error(`AG-UI preview checksum mismatch for ${name}`);
    }
    const packed = document(
      execFileSync("tar", ["-xzOf", "-", "package/package.json"], {
        input: bytes,
        encoding: "utf8",
      }),
    );
    if (packed.get("name") !== name || packed.get("version") !== version) {
      throw new Error(`AG-UI preview package identity mismatch for ${name}`);
    }
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `${name.slice("@ag-ui/".length)}.tgz`);
    writeFileSync(path, bytes);
    tarballs.set(name, path);
  }
  return tarballs;
}
