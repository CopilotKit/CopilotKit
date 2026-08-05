export type ContentMemoKey = string | number;

let unsupportedContentCounter = 0;

type ContentHash = {
  primary: number;
  secondary: number;
};

function updateContentHash(hash: ContentHash, value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    hash.primary = Math.imul(hash.primary ^ code, 16777619) >>> 0;
    hash.secondary = Math.imul(hash.secondary ^ code, 2246822519) >>> 0;
  }
}

function hashStableContent(
  value: unknown,
  hash: ContentHash,
  ancestors = new WeakSet<object>(),
): void {
  if (value === null) {
    updateContentHash(hash, "null;");
    return;
  }

  switch (typeof value) {
    case "string":
      updateContentHash(hash, `string:${value.length}:${value};`);
      return;
    case "number":
      updateContentHash(
        hash,
        Number.isNaN(value) ? "number:NaN;" : `number:${String(value)};`,
      );
      return;
    case "boolean":
      updateContentHash(hash, `boolean:${value};`);
      return;
    case "object":
      break;
    default:
      throw new TypeError("Unsupported content value");
  }

  if (ancestors.has(value)) {
    throw new TypeError("Cannot hash cyclic content");
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      updateContentHash(hash, `array:${value.length}:[`);
      for (const item of value) hashStableContent(item, hash, ancestors);
      updateContentHash(hash, "];");
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Unsupported content object");
    }

    const keys = Object.keys(value).sort();
    updateContentHash(hash, `object:${keys.length}:{`);
    for (const key of keys) {
      updateContentHash(hash, `key:${key.length}:${key}=`);
      hashStableContent(
        (value as Record<string, unknown>)[key],
        hash,
        ancestors,
      );
    }
    updateContentHash(hash, "};");
  } finally {
    ancestors.delete(value);
  }
}

export function getContentMemoKey(content: unknown): ContentMemoKey {
  switch (typeof content) {
    case "string":
      return content.length;
    case "number":
      return Number.isNaN(content) ? "number:NaN;" : `number:${content};`;
    case "boolean":
      return `boolean:${content};`;
    case "object":
      if (content === null) return "null;";
      if (Array.isArray(content)) return content.length;
      {
        const hash: ContentHash = {
          primary: 2166136261,
          secondary: 2166136261,
        };
        try {
          hashStableContent(content, hash);
          return `${hash.primary.toString(16)}:${hash.secondary.toString(16)}`;
        } catch {
          // Unsupported or cyclic objects have no protocol-defined revision and
          // can change without being hashable; return a fresh value each call
          // so the memo key fails safe (re-renders) rather than freezing.
          unsupportedContentCounter += 1;
          return unsupportedContentCounter;
        }
      }
    default:
      if (content === undefined) return "undefined;";
      // bigint, symbol, or function content has no stable shape; return a fresh
      // value so the memo never collapses to a constant.
      unsupportedContentCounter += 1;
      return unsupportedContentCounter;
  }
}
