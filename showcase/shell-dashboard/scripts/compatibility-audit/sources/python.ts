import type { LibraryMapping, SavedFileReader, VersionFact } from "../types";

function canonicalName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

export function resolvePythonSource(
  library: LibraryMapping,
  read: SavedFileReader,
): VersionFact {
  const path = library.source.path;
  const unknown = (reason: string): VersionFact => ({
    version: null,
    basis: "unknown",
    evidence: [path],
    reason,
  });
  if (library.source.kind !== "requirements") {
    return unknown("Mapped source is not a Python requirements file");
  }

  const target = canonicalName(library.name);
  const versions: string[] = [];
  const uncertainReasons: string[] = [];
  let unresolvedInclude = false;
  for (const rawLine of read(path).split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;

    if (/^(?:-r|--requirement|-c|--constraint)(?:\s|=|\/|\.|$)/i.test(line)) {
      unresolvedInclude = true;
      continue;
    }
    if (/^(?:git\+|hg\+|svn\+|bzr\+|https?:\/\/|file:\/\/)/i.test(line)) {
      const egg = /(?:[#&]egg=)([A-Za-z0-9][A-Za-z0-9._-]*)/i.exec(rawLine);
      if (!egg || canonicalName(egg[1]) === target) {
        uncertainReasons.push("direct URL requirement");
      }
      continue;
    }
    if (/^(?:-e|--editable)(?:\s|=|$)/i.test(line)) {
      const egg = /(?:[#&]egg=)([A-Za-z0-9][A-Za-z0-9._-]*)/i.exec(rawLine);
      if (!egg || canonicalName(egg[1]) === target) {
        uncertainReasons.push("editable or URL requirement");
      }
      continue;
    }

    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*\[[^\]]*\])?(.*)$/.exec(
      line,
    );
    if (!match || canonicalName(match[1]) !== target) continue;
    const specifier = match[2].trim();
    if (specifier.includes(";")) {
      uncertainReasons.push("conditional requirement marker");
      continue;
    }
    if (/^@\s*\S+/.test(specifier)) {
      uncertainReasons.push("direct URL requirement");
      continue;
    }
    const pin = /^==\s*([A-Za-z0-9][A-Za-z0-9.!+_-]*)$/.exec(specifier);
    if (pin && !pin[1].includes("*")) {
      versions.push(pin[1]);
    } else if (!specifier) {
      uncertainReasons.push("unpinned requirement");
    } else {
      uncertainReasons.push("range, wildcard, or unsupported requirement");
    }
  }

  if (unresolvedInclude)
    return unknown(
      "An indirect requirements include could change the mapped declaration",
    );
  if (uncertainReasons.length) {
    return unknown(
      `Mapped distribution has a non-exact declaration: ${uncertainReasons[0]}`,
    );
  }
  if (!versions.length)
    return unknown("Mapped distribution declaration is absent");
  if (new Set(versions).size !== 1)
    return unknown("Conflicting exact pins for mapped distribution");
  return {
    version: versions[0],
    basis: "source-declared",
    evidence: [path],
    reason: "Exact pin in mapped requirements file",
  };
}
