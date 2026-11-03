/**
 * The part of npm's semver that the notification and HUD feeds use: version
 * validation and range matching. It follows node-semver's rules for the npm
 * range syntax (comparators, `^`, `~`, x-ranges, hyphen ranges and `||`), so a
 * feed rule matches the same SDK versions here as it does in `semver`.
 */

interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
}

type Operator = "<" | "<=" | ">" | ">=" | "=";
interface Comparator {
  operator: Operator;
  version: Version;
}

const MAX_LENGTH = 256;
const IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)";
const PRERELEASE = `(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?`;
const BUILD = "(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?";
const NUMBER = "(0|[1-9]\\d*)";
const FULL_VERSION = new RegExp(
  `^v?${NUMBER}\\.${NUMBER}\\.${NUMBER}${PRERELEASE}${BUILD}$`,
);
const PART = "(0|[1-9]\\d*|x|X|\\*)";
const PARTIAL_VERSION = new RegExp(
  `^v?${PART}(?:\\.${PART}(?:\\.${PART}${PRERELEASE}${BUILD})?)?$`,
);
const COMPARATOR = /^(<=|>=|<|>|=|~>|~|\^)?(.*)$/;

function parseIdentifiers(value: string | undefined): Array<string | number> {
  if (!value) return [];
  return value.split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id));
}

function parseVersion(value: string): Version | null {
  const trimmed = value.trim();
  if (trimmed.length > MAX_LENGTH) return null;
  const match = FULL_VERSION.exec(trimmed);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch, prerelease: parseIdentifiers(match[4]) };
}

function compareIdentifiers(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compare(a: Version, b: Version): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core) return core;
  if (!a.prerelease.length || !b.prerelease.length)
    return b.prerelease.length - a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const result = compareIdentifiers(left, right);
    if (result) return result;
  }
  return 0;
}

/** The lowest version of a release line: `1.2.3-0` sorts before every `1.2.3-*`. */
function floor(major: number, minor: number, patch: number): Version {
  return { major, minor, patch, prerelease: [0] };
}

function at(major: number, minor: number, patch: number): Version {
  return { major, minor, patch, prerelease: [] };
}

const NOTHING: Comparator[] = [{ operator: "<", version: floor(0, 0, 0) }];

/** Desugar one comparator, such as `^1.2` or `>=1.70.1`, into plain bounds. */
function parseComparator(value: string): Comparator[] | null {
  const [, rawOperator = "", rest = ""] = COMPARATOR.exec(value) ?? [];
  const match = PARTIAL_VERSION.exec(rest);
  if (!match) return null;
  const isWild = (part: string | undefined) =>
    part === undefined || part === "x" || part === "X" || part === "*";
  const [majorPart, minorPart, patchPart] = match.slice(1, 4);
  const major = isWild(majorPart) ? null : Number(majorPart);
  const minor = major === null || isWild(minorPart) ? null : Number(minorPart);
  const patch = minor === null || isWild(patchPart) ? null : Number(patchPart);
  const prerelease = patch === null ? [] : parseIdentifiers(match[4]);
  const operator = rawOperator === "~>" ? "~" : rawOperator;

  if (operator === "~" || operator === "^") {
    if (major === null) return [];
    const lower: Comparator = {
      operator: ">=",
      version: { major, minor: minor ?? 0, patch: patch ?? 0, prerelease },
    };
    let upper: Version;
    if (operator === "~" || minor === null) {
      upper =
        minor === null || operator === "^"
          ? floor(major + 1, 0, 0)
          : floor(major, minor + 1, 0);
    } else if (major > 0) upper = floor(major + 1, 0, 0);
    else if (minor > 0 || patch === null) upper = floor(0, minor + 1, 0);
    else upper = floor(0, 0, patch + 1);
    return [lower, { operator: "<", version: upper }];
  }

  if (major === null) {
    return operator === "<" || operator === ">" ? NOTHING : [];
  }
  if (patch !== null) {
    return [
      {
        operator: (operator || "=") as Operator,
        version: { major, minor: minor!, patch, prerelease },
      },
    ];
  }

  // A partial version: `1` is 1.x.x and `1.2` is 1.2.x.
  const lower = at(major, minor ?? 0, 0);
  const next =
    minor === null ? floor(major + 1, 0, 0) : floor(major, minor + 1, 0);
  switch (operator) {
    case ">":
      return [{ operator: ">=", version: { ...next, prerelease: [] } }];
    case ">=":
      return [{ operator: ">=", version: lower }];
    case "<":
      return [{ operator: "<", version: floor(major, minor ?? 0, 0) }];
    case "<=":
      return [{ operator: "<", version: next }];
    default:
      return [
        { operator: ">=", version: lower },
        { operator: "<", version: next },
      ];
  }
}

/** Desugar `1.2 - 2.3.4` into `>=1.2.0 <=2.3.4`. */
function parseHyphen(from: string, to: string): Comparator[] | null {
  const lower = parseComparator(">=" + from);
  const upper = PARTIAL_VERSION.exec(to);
  if (!lower || !upper) return null;
  const full = parseComparator("=" + to);
  if (full?.length === 1 && full[0])
    return [...lower, { operator: "<=", version: full[0].version }];
  return [...lower, ...(parseComparator("<=" + to) ?? [])];
}

function parseRange(range: string): Comparator[][] | null {
  if (range.length > MAX_LENGTH) return null;
  const sets: Comparator[][] = [];
  for (const raw of range.split("||")) {
    const set = raw.trim().replace(/(<=|>=|<|>|=|~>|~|\^)\s+/g, "$1");
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen) {
      const comparators = parseHyphen(hyphen[1] ?? "", hyphen[2] ?? "");
      if (!comparators) return null;
      sets.push(comparators);
      continue;
    }
    const comparators: Comparator[] = [];
    for (const part of set.split(/\s+/).filter(Boolean)) {
      const parsed = parseComparator(part);
      if (!parsed) return null;
      comparators.push(...parsed);
    }
    sets.push(comparators);
  }
  return sets;
}

function test(version: Version, { operator, version: bound }: Comparator) {
  const result = compare(version, bound);
  switch (operator) {
    case "<":
      return result < 0;
    case "<=":
      return result <= 0;
    case ">":
      return result > 0;
    case ">=":
      return result >= 0;
    default:
      return result === 0;
  }
}

function sameLine(a: Version, b: Version): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

function satisfiesSet(version: Version, set: Comparator[]): boolean {
  if (!set.every((comparator) => test(version, comparator))) return false;
  // A prerelease only matches a range that names a prerelease of its line.
  if (!version.prerelease.length) return true;
  return set.some(
    ({ version: bound }) =>
      bound.prerelease.length > 0 && sameLine(bound, version),
  );
}

/** Whether `value` is a stable version, such as `1.70.2`, and not `1.70.2-beta.1`. */
export function isStableVersion(value: string): boolean {
  const version = parseVersion(value);
  return version !== null && version.prerelease.length === 0;
}

/** Whether `range` is a valid npm range, such as `>=1.70.1 <1.71.0` or `^1.73.0`. */
export function isValidRange(range: string): boolean {
  return parseRange(range) !== null;
}

/** Whether `version` is in `range`, with the same result as `semver.satisfies`. */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  const sets = parseRange(range);
  if (!parsed || !sets) return false;
  return sets.some((set) => satisfiesSet(parsed, set));
}
