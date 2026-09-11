const MAX_SLACK_ACTION_ID_LENGTH = 255;
const HASH_PREFIX = "h:";

export function previewActionId(
  surfaceId: string,
  componentId: string,
  actionName: string,
): string {
  const tuple = [surfaceId, componentId, actionName] as const;
  const raw = ["a2ui", ...tuple.map(encodeTupleField)].join("|");
  if (raw.length <= MAX_SLACK_ACTION_ID_LENGTH) {
    return raw;
  }

  const suffix = `${HASH_PREFIX}${stableHash(JSON.stringify(tuple))}`;
  const budget = MAX_SLACK_ACTION_ID_LENGTH - suffix.length - 1;
  return `${raw.slice(0, budget)}|${suffix}`;
}

function encodeTupleField(value: string): string {
  return encodeURIComponent(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
