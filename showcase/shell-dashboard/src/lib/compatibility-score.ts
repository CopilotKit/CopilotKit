interface VersionCore {
  major: number;
  minor: number;
  patch: number;
}

interface PreviewTrain {
  id: string;
  major: number;
  date: number;
}

interface Version extends VersionCore {
  preview: { train: string; revision: number } | null;
}

function parseTrainDate(value: string): number | null {
  const year = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const daysInMonth = [
    31,
    year % 4 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    return null;
  }

  return Number(value);
}

function parseVersion(value: string | null): Version | null {
  if (value === null) return null;

  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(\d{6})\.(0|[1-9]\d*))?$/.exec(
      value,
    );
  // JavaScript's $ anchor also matches before a final newline.
  if (!match || match[0] !== value) return null;

  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;

  if (match[4] === undefined) {
    return { major, minor, patch, preview: null };
  }

  const revision = Number(match[5]);
  if (parseTrainDate(match[4]) === null || !Number.isSafeInteger(revision))
    return null;

  return {
    major,
    minor,
    patch,
    preview: { train: `${major}.preview.${match[4]}`, revision },
  };
}

function parsePreviewTrain(value: string): PreviewTrain | null {
  const match = /^(0|[1-9]\d*)\.preview\.(\d{6})$/.exec(value);
  if (!match || match[0] !== value) return null;

  const major = Number(match[1]);
  const date = parseTrainDate(match[2]);
  if (!Number.isSafeInteger(major) || date === null) return null;

  return { id: value, major, date };
}

function compareCore(a: VersionCore, b: VersionCore): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function scoreMajorGap(gap: number): number {
  return gap === 1 ? 20 : 5;
}

function scoreMinorGap(gap: number): number {
  if (gap === 1) return 89;
  if (gap === 2) return 80;
  if (gap === 3) return 70;
  return 60;
}

function scorePatchGap(gap: number): number {
  return gap <= 5 ? 100 - gap : 89;
}

function scoreCoreVersions(
  running: VersionCore,
  latest: VersionCore,
): number | null {
  if (compareCore(running, latest) > 0) return null;

  const majorGap = latest.major - running.major;
  if (majorGap > 0) return scoreMajorGap(majorGap);

  const minorGap = latest.minor - running.minor;
  if (minorGap > 0) {
    return latest.major === 0
      ? scoreMajorGap(minorGap)
      : scoreMinorGap(minorGap);
  }

  return scorePatchGap(latest.patch - running.patch);
}

/** Score against a saved latest release, using only supplied version and train facts. */
export function scoreCompatibilityVersion(input: {
  runningVersion: string | null;
  latest: string | null;
  previewTrains?: readonly string[];
}): number | null {
  const running = parseVersion(input.runningVersion);
  const latest = parseVersion(input.latest);
  if (!running || !latest) return null;

  // Preview-to-stable comparisons use the numeric base without altering the input.
  if (!latest.preview) return scoreCoreVersions(running, latest);
  if (!running.preview || !input.previewTrains) return null;

  const trains = [...new Set(input.previewTrains)]
    .map(parsePreviewTrain)
    .filter((train): train is PreviewTrain => train !== null)
    .sort((a, b) => a.major - b.major || a.date - b.date);
  const runningIndex = trains.findIndex(
    (train) => train.id === running.preview?.train,
  );
  const latestIndex = trains.findIndex(
    (train) => train.id === latest.preview?.train,
  );
  if (runningIndex < 0 || latestIndex < 0) return null;

  const majorGap = latest.major - running.major;
  if (majorGap < 0) return null;
  if (majorGap > 0) return scoreMajorGap(majorGap);

  const trainGap = latestIndex - runningIndex;
  if (trainGap < 0) return null;
  if (trainGap > 0) return scoreMinorGap(trainGap);

  const revisionGap = latest.preview.revision - running.preview.revision;
  if (revisionGap < 0) return null;
  if (revisionGap === 0 && compareCore(running, latest) !== 0) return null;

  return scorePatchGap(revisionGap);
}

/** Every required package must be scored before their minimum can score a variant. */
export function aggregateCompatibilityScores(
  scores: readonly (number | null)[],
): number | null {
  if (scores.length === 0) return null;

  let minimum = Infinity;
  for (const score of scores) {
    if (score === null) return null;
    minimum = Math.min(minimum, score);
  }

  return minimum;
}
