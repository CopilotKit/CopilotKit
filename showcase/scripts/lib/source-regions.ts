const REGION_START_RE = /@region\[([a-z0-9][a-z0-9-]*)\]/;
const REGION_END_RE = /@endregion\[([a-z0-9][a-z0-9-]*)\]/;
const REGION_ANY_RE = /@(?:end)?region\[[^\]]*\]/;

export interface ExtractedRegion {
  startLine: number;
  endLine: number;
  lines: string[];
}

/**
 * Remove named region markers while collecting their source slices.
 *
 * Markers may use any comment syntax because the `@region[...]` token is
 * language-independent. Nested regions are supported.
 */
export function extractRegions(
  source: string,
  fileLabel: string,
): { cleaned: string; regions: Record<string, ExtractedRegion[]> } {
  const sourceLines = source.split("\n");
  const cleaned: string[] = [];
  const stack: Array<{ name: string; startLine: number }> = [];
  const regions: Record<string, ExtractedRegion[]> = {};
  const buffers: string[][] = [];

  for (const rawLine of sourceLines) {
    const startMatch = rawLine.match(REGION_START_RE);
    const endMatch = rawLine.match(REGION_END_RE);

    if (startMatch && endMatch) {
      throw new Error(
        `${fileLabel}: same line contains both @region and @endregion — that's not supported.`,
      );
    }

    if (startMatch) {
      const name = startMatch[1];
      stack.push({ name, startLine: cleaned.length + 1 });
      buffers.push([]);
      continue;
    }

    if (endMatch) {
      const name = endMatch[1];
      const top = stack.pop();
      const buffer = buffers.pop();
      if (!top || !buffer) {
        throw new Error(
          `${fileLabel}: @endregion[${name}] without a matching @region[...].`,
        );
      }
      if (top.name !== name) {
        throw new Error(
          `${fileLabel}: @endregion[${name}] does not match innermost open region @region[${top.name}].`,
        );
      }
      const startLine = top.startLine;
      const endLine = cleaned.length;
      (regions[name] ||= []).push({
        startLine,
        endLine: endLine < startLine ? startLine - 1 : endLine,
        lines: endLine < startLine ? [] : buffer,
      });
      continue;
    }

    if (REGION_ANY_RE.test(rawLine)) {
      throw new Error(
        `${fileLabel}: malformed region marker "${rawLine.trim()}". Use @region[kebab-case-name] / @endregion[kebab-case-name].`,
      );
    }

    cleaned.push(rawLine);
    for (const buffer of buffers) buffer.push(rawLine);
  }

  if (stack.length > 0) {
    const unclosed = stack.map(({ name }) => name).join(", ");
    throw new Error(`${fileLabel}: unclosed @region[${unclosed}].`);
  }

  return { cleaned: cleaned.join("\n"), regions };
}
