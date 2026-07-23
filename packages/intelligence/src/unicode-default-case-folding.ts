import { unicodeDefaultCaseFoldMappings } from "./unicode-default-case-folding-data.js";

/**
 * Applies Unicode 17.0.0 full Default Case Folding (C and F mappings) without
 * locale-specific Turkic mappings.
 */
export function unicodeDefaultCaseFold(value: string): string {
  let folded = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    folded +=
      codePoint === undefined
        ? character
        : (unicodeDefaultCaseFoldMappings.get(codePoint) ?? character);
  }
  return folded;
}
