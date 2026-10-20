import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Normalizes line endings without changing the license text. */
function normalize(text) {
  return text.replaceAll("\r\n", "\n").trim();
}

/** Reads a bounded file from an archive without extracting or executing it. */
function archiveText(archive, file) {
  return execFileSync("tar", ["-xOf", resolve(archive), file], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Checks the shipped identity, SPDX field, and full approved license notice. */
export function verifyArchive(archive, expected) {
  const files = execFileSync("tar", ["-tzf", resolve(archive)], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .trim()
    .split("\n");
  for (const file of ["package/package.json", "package/LICENSE"]) {
    if (files.filter((entry) => entry === file).length !== 1) {
      throw new Error(`The archive must contain exactly one ${file}`);
    }
  }
  const manifest = JSON.parse(archiveText(archive, "package/package.json"));
  if (!expected.names.includes(manifest.name))
    throw new Error(`Unexpected package name: ${manifest.name}`);
  if (manifest.license !== expected.license) {
    throw new Error(
      `${manifest.name}: license must be ${expected.license}; received ${manifest.license ?? "<missing>"}`,
    );
  }
  if (
    !normalize(expected.notice) ||
    normalize(archiveText(archive, "package/LICENSE")) !==
      normalize(expected.notice)
  ) {
    throw new Error(
      `${manifest.name}: packed license notice differs from the approved source notice`,
    );
  }
}

/** Loads the explicit package policy, independent of the fields under test. */
function policies() {
  return JSON.parse(
    readFileSync(join(root, "scripts/package-licenses/policy.json"), "utf8"),
  );
}

/** Checks source metadata and refuses new public packages without a policy entry. */
function checkSources(entries) {
  const paths = execFileSync("git", ["ls-files", "-z", "**/package.json"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    if (
      !manifest.private &&
      (/^@(copilotkit|copilotkitnext|ag-ui)\//.test(manifest.name ?? "") ||
        ["copilotkit", "create-ag-ui-app"].includes(manifest.name))
    ) {
      if (
        !entries.some(
          (entry) =>
            `${entry.directory}/package.json` === path &&
            entry.names.includes(manifest.name),
        )
      ) {
        throw new Error(
          `Public package ${manifest.name} needs a license policy entry`,
        );
      }
    }
  }
  for (const entry of entries) {
    const manifest = JSON.parse(
      readFileSync(join(root, entry.directory, "package.json"), "utf8"),
    );
    if (
      !entry.names.includes(manifest.name) ||
      manifest.license !== entry.license
    ) {
      throw new Error(
        `${entry.directory}: expected package name and license ${entry.license}`,
      );
    }
    if (!normalize(readFileSync(join(root, entry.notice), "utf8")))
      throw new Error(`Empty notice: ${entry.notice}`);
  }
}

/** Runs source checks or checks the exact archive produced by the package manager. */
function main([mode, archive, directory]) {
  const entries = policies();
  if (mode === "archive") {
    const entry = entries.find(
      (value) =>
        resolve(root, value.directory) === resolve(root, directory ?? ""),
    );
    if (!entry || !archive)
      throw new Error("Usage: check.mjs archive <tarball> <policy directory>");
    verifyArchive(archive, {
      ...entry,
      notice: readFileSync(join(root, entry.notice), "utf8"),
    });
    console.log(`License checked: ${archive}`);
    return;
  }
  if (!["check", "pack"].includes(mode))
    throw new Error("Usage: check.mjs check|pack|archive");
  checkSources(entries);
  if (mode === "pack") {
    const destination = mkdtempSync(join(tmpdir(), "package-licenses-"));
    try {
      for (const [index, entry] of entries.entries()) {
        const output = join(destination, String(index));
        mkdirSync(output);
        const packageDirectory = entry.packDirectory ?? entry.directory;
        execFileSync("pnpm", ["pack", "--pack-destination", output], {
          cwd: join(root, packageDirectory),
          stdio: "pipe",
        });
        const archives = readdirSync(output).filter((file) =>
          file.endsWith(".tgz"),
        );
        if (archives.length !== 1)
          throw new Error(`Expected one packed archive for ${entry.directory}`);
        verifyArchive(join(output, archives[0]), {
          ...entry,
          notice: readFileSync(join(root, entry.notice), "utf8"),
        });
        console.log(`License checked: ${entry.names[0]}`);
      }
    } finally {
      rmSync(destination, { recursive: true, force: true });
    }
  }
  console.log(`License policy passed for ${entries.length} packages`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
