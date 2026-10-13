import type { Inventory, Registry, ReleasePolicy } from "./types";

export interface ReleaseSelection {
  latest: string | null;
  previewTrains: string[];
  unavailableReason: string | null;
}

interface StableVersion {
  original: string;
  epoch: number;
  core: number[];
  suffix: number;
  suffixNumber: number;
}

type ClassifiedVersion =
  | { kind: "stable"; value: StableVersion }
  | { kind: "preview"; train?: string; revision?: number; core?: number[] }
  | { kind: "unknown"; core?: number[]; epoch?: number };

function numbers(parts: string[]): number[] | null {
  const parsed = parts.map(Number);
  return parsed.every(Number.isSafeInteger) ? parsed : null;
}

function compareNumbers(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function compareStable(left: StableVersion, right: StableVersion): number {
  return (
    Math.sign(left.epoch - right.epoch) ||
    compareNumbers(left.core, right.core) ||
    Math.sign(left.suffix - right.suffix) ||
    Math.sign(left.suffixNumber - right.suffixNumber)
  );
}

function validSemverIdentifiers(value: string, prerelease: boolean): boolean {
  return value
    .split(".")
    .every(
      (part) =>
        part.length > 0 &&
        (!prerelease ||
          !/^\d+$/.test(part) ||
          part === "0" ||
          !part.startsWith("0")),
    );
}

function previewDate(value: string): boolean {
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function classify(version: string, registry: Registry): ClassifiedVersion {
  if (registry === "npm" || registry === "nuget") {
    const match =
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
        version,
      );
    const prefix = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    const core = prefix ? (numbers(prefix.slice(1)) ?? undefined) : undefined;
    if (
      !match ||
      (registry === "npm" && match[4] !== undefined) ||
      (match[5] !== undefined &&
        !validSemverIdentifiers(match[5], registry === "npm")) ||
      (match[6] !== undefined && !validSemverIdentifiers(match[6], false))
    )
      return { kind: "unknown", core };
    const parsed = numbers(match.slice(1, match[4] === undefined ? 4 : 5));
    if (!parsed) return { kind: "unknown", core };
    if (match[5] !== undefined) {
      const dated = /^preview\.(\d{6})\.(0|[1-9]\d*)$/i.exec(match[5]);
      const revision = dated ? Number(dated[2]) : NaN;
      return {
        kind: "preview",
        core: parsed,
        ...(registry === "nuget" &&
        dated &&
        previewDate(dated[1]) &&
        Number.isSafeInteger(revision)
          ? { train: `${parsed[0]}.preview.${dated[1]}`, revision }
          : {}),
      };
    }
    return {
      kind: "stable",
      value: {
        original: version,
        epoch: 0,
        core: parsed,
        suffix: 0,
        suffixNumber: 0,
      },
    };
  }

  if (registry === "pypi") {
    const match =
      /^(?:(\d+)!)?v?(\d+(?:\.\d+)*)(?:(a|b|rc)(\d+))?(?:(?:\.post|-)(\d+))?(?:\.dev\d+)?(?:\+[A-Za-z0-9._-]+)?$/i.exec(
        version,
      );
    const prefix = /^(?:(\d+)!)?v?(\d+(?:\.\d+)*)/i.exec(version);
    const core = prefix
      ? (numbers(prefix[2].split(".")) ?? undefined)
      : undefined;
    const prefixEpoch = prefix ? Number(prefix[1] ?? 0) : undefined;
    if (prefixEpoch !== undefined && !Number.isSafeInteger(prefixEpoch))
      return { kind: "unknown" };
    if (!match || !core) return { kind: "unknown", core, epoch: prefixEpoch };
    const epoch = Number(match[1] ?? 0);
    const post = Number(match[5] ?? 0);
    if (!Number.isSafeInteger(epoch) || !Number.isSafeInteger(post))
      return { kind: "unknown", core, epoch };
    if (match[3] || /\.dev\d+/i.test(version)) return { kind: "preview", core };
    // PEP 440 local versions have a separate ordering that this selector does not approximate.
    if (version.includes("+")) return { kind: "unknown", core, epoch };
    return {
      kind: "stable",
      value: {
        original: version,
        epoch,
        core,
        suffix: match[5] ? 1 : 0,
        suffixNumber: post,
      },
    };
  }

  const match =
    /^(\d+(?:\.\d+)*)(?:(?:[-.]?(final|ga|release))|(?:[-.]?sp[.-]?(\d+)))?$/i.exec(
      version,
    );
  const prefix = /^(\d+(?:\.\d+)*)/.exec(version);
  const core = prefix
    ? (numbers(prefix[1].split(".")) ?? undefined)
    : undefined;
  if (match && core) {
    const servicePack = match[3] === undefined ? 0 : Number(match[3]);
    if (!Number.isSafeInteger(servicePack)) return { kind: "unknown", core };
    return {
      kind: "stable",
      value: {
        original: version,
        epoch: 0,
        core,
        suffix: match[3] === undefined ? 0 : 1,
        suffixNumber: servicePack,
      },
    };
  }
  const preview =
    /^\d+(?:\.\d+)*(?:[-.](?:alpha|beta|rc|cr|milestone|preview|dev)(?:[.-]?\d+)?|[-.]m\d+|[-.]snapshot)$/i;
  if (core && preview.test(version)) return { kind: "preview", core };
  return { kind: "unknown", core };
}

interface Timestamp {
  wholeSecond: number;
  fraction: string;
}

function timestamp(value: string): Timestamp | null {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  if (!match || match[0] !== value) return null;
  const wholeSecond = Date.parse(`${match[1]}${match[3]}`);
  // Validate the stated local calendar without its offset: Date.parse can
  // normalize impossible dates, while a valid offset may cross a UTC day.
  const calendar = Date.parse(`${match[1]}Z`);
  return Number.isFinite(wholeSecond) &&
    Number.isFinite(calendar) &&
    new Date(calendar).toISOString().slice(0, 19) === match[1]
    ? { wholeSecond, fraction: match[2] ?? "" }
    : null;
}

function compareTimestamp(left: Timestamp, right: Timestamp): number {
  if (left.wholeSecond !== right.wholeSecond)
    return Math.sign(left.wholeSecond - right.wholeSecond);
  for (
    let index = 0;
    index < Math.max(left.fraction.length, right.fraction.length);
    index++
  ) {
    const leftDigit = left.fraction[index] ?? "0";
    const rightDigit = right.fraction[index] ?? "0";
    if (leftDigit !== rightDigit) return leftDigit < rightDigit ? -1 : 1;
  }
  return 0;
}

function unavailable(reason: string): ReleaseSelection {
  return { latest: null, previewTrains: [], unavailableReason: reason };
}

/** Choose a dated registry target without interpreting its compatibility score. */
export function selectRelease(
  inventory: Inventory,
  policy: ReleasePolicy,
  asOf: string,
): ReleaseSelection {
  const cutoff = timestamp(asOf);
  if (cutoff === null) return unavailable("Invalid as-of timestamp");
  if (!inventory.complete)
    return unavailable("Release inventory is incomplete");

  const approvedPreview =
    policy === "stable-or-ms-preview" &&
    inventory.registry === "nuget" &&
    /^Microsoft\.Agents\.AI(?:\.|$)/i.test(inventory.name);
  const stable: StableVersion[] = [];
  const uncertain: Array<{ version: string; core?: number[]; epoch?: number }> =
    [];
  const previews: Array<{
    version: string;
    train: string;
    revision: number;
    core: number[];
  }> = [];

  for (const release of inventory.releases) {
    if (!release.eligible) continue;
    const parsed = classify(release.version, inventory.registry);
    if (parsed.kind === "preview" && !approvedPreview) continue;
    const published =
      release.timestamp === null ? null : timestamp(release.timestamp);
    if (published === null) {
      if (parsed.kind !== "preview" || approvedPreview)
        return unavailable(
          `Missing or invalid timestamp for ${release.version}`,
        );
      continue;
    }
    if (compareTimestamp(published, cutoff) > 0) continue;
    if (parsed.kind === "stable") stable.push(parsed.value);
    else if (parsed.kind === "unknown")
      uncertain.push({
        version: release.version,
        core: parsed.core,
        epoch: parsed.epoch,
      });
    else if (
      approvedPreview &&
      parsed.train &&
      parsed.revision !== undefined &&
      parsed.core
    ) {
      previews.push({
        version: release.version,
        train: parsed.train,
        revision: parsed.revision,
        core: parsed.core,
      });
    }
  }

  stable.sort(compareStable);
  const latestStable = stable.at(-1);
  for (const candidate of uncertain) {
    if (
      !latestStable ||
      !candidate.core ||
      (candidate.epoch !== undefined && candidate.epoch > latestStable.epoch) ||
      ((candidate.epoch === undefined ||
        candidate.epoch === latestStable.epoch) &&
        compareNumbers(candidate.core, latestStable.core) >= 0)
    )
      return unavailable(
        `Cannot order possibly latest release ${candidate.version}`,
      );
  }
  if (latestStable)
    return {
      latest: latestStable.original,
      previewTrains: [],
      unavailableReason: null,
    };
  if (!approvedPreview || previews.length === 0)
    return unavailable("No eligible stable release at the cutoff");

  previews.sort(
    (a, b) =>
      compareNumbers(a.core, b.core) ||
      a.train.localeCompare(b.train) ||
      Math.sign(a.revision - b.revision),
  );
  const trains = [...new Set(previews.map((preview) => preview.train))].sort(
    (a, b) => {
      const left = a.match(/^(\d+)\.preview\.(\d{6})$/)!;
      const right = b.match(/^(\d+)\.preview\.(\d{6})$/)!;
      return (
        Number(left[1]) - Number(right[1]) || Number(left[2]) - Number(right[2])
      );
    },
  );
  return {
    latest: previews.at(-1)!.version,
    previewTrains: trains,
    unavailableReason: null,
  };
}
