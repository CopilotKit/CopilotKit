const CANONICAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|([+-])(\d{2}):(\d{2}))$/u;

type CanonicalDateTimeInstant = {
  readonly epochSecond: bigint;
  readonly fractionalSecond: string;
};

function parseCanonicalDateTimeInstant(
  value: string,
): CanonicalDateTimeInstant | undefined {
  const match = CANONICAL_DATE_TIME_PATTERN.exec(value);
  if (match === null) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const wallTime = new Date(0);
  wallTime.setUTCFullYear(year, month - 1, day);
  wallTime.setUTCHours(hour, minute, second, 0);
  if (
    wallTime.getUTCFullYear() !== year ||
    wallTime.getUTCMonth() !== month - 1 ||
    wallTime.getUTCDate() !== day ||
    wallTime.getUTCHours() !== hour ||
    wallTime.getUTCMinutes() !== minute ||
    wallTime.getUTCSeconds() !== second
  ) {
    return undefined;
  }

  const offsetDirection = match[9] === "-" ? -1 : 1;
  const offsetSeconds =
    match[8] === "Z"
      ? 0
      : offsetDirection *
        (Number(match[10]) * 60 * 60 + Number(match[11]) * 60);
  return {
    epochSecond: BigInt(wallTime.getTime() / 1_000) - BigInt(offsetSeconds),
    fractionalSecond: match[7] ?? "",
  };
}

function compareFractionalSeconds(left: string, right: string): -1 | 0 | 1 {
  const precision = Math.max(left.length, right.length);
  const normalizedLeft = left.padEnd(precision, "0");
  const normalizedRight = right.padEnd(precision, "0");
  return normalizedLeft < normalizedRight
    ? -1
    : normalizedLeft > normalizedRight
      ? 1
      : 0;
}

/** Compares canonical offset-aware ISO date-times without losing precision. */
export function compareCanonicalDateTimes(
  left: string,
  right: string,
): -1 | 0 | 1 | undefined {
  const leftInstant = parseCanonicalDateTimeInstant(left);
  const rightInstant = parseCanonicalDateTimeInstant(right);
  if (leftInstant === undefined || rightInstant === undefined) return undefined;
  if (leftInstant.epochSecond < rightInstant.epochSecond) return -1;
  if (leftInstant.epochSecond > rightInstant.epochSecond) return 1;
  return compareFractionalSeconds(
    leftInstant.fractionalSecond,
    rightInstant.fractionalSecond,
  );
}
