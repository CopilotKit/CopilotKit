import type { ProductInteractionText } from "./types";
import { readPublicText, visibleElement } from "./privacy";

const sensitiveFieldHint =
  /\b(?:user[\s_.-]*name|(?:full|first|last|given|family|display|legal)[\s_.-]*name|(?:street|home|postal|billing|shipping|mailing)[\s_.-]*address|address|e[\s_.-]*mail|phone|mobile|password|passwd|passcode|secret|token|api[\s_.-]*key|credit[\s_.-]*card|card[\s_.-]*number|cvv|cvc|ssn|social[\s_.-]*security)\b/i;

/** These bounded heuristics are not anonymization of arbitrary task prose. */
export function sensitiveContent(value: string): boolean {
  const inspected = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  for (const character of inspected) {
    const code = character.charCodeAt(0);
    if (
      (code < 32 || (code >= 127 && code <= 159)) &&
      code !== 9 &&
      code !== 10 &&
      code !== 13
    )
      return true;
  }
  return (
    /[^\s@]+@[^\s@]+\.[^\s@]+/u.test(inspected) ||
    /\b(?:https?|ftp):\/\/|\bwww\./i.test(inspected) ||
    /(?:\p{Nd}[\s()+.-]*){7,}/u.test(inspected) ||
    /\b(?:password|passwd|passcode|secret|api[ _-]?key|(?:access|refresh)[ _-]?token|token|authorization)["']?\s*[:=]\s*\S/i.test(
      inspected,
    ) ||
    /\bbearer\s+[a-z0-9._~+/-]{8,}/i.test(inspected)
  );
}

export function hasSensitiveFieldHint(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): boolean {
  const hints: string[] = [];
  const sensitiveHint = (hint: string) => {
    const words = hint.replace(/([a-z])([A-Z])/g, "$1 $2");
    return sensitiveFieldHint.test(words) || /^\s*name\s*$/i.test(words);
  };
  for (const attribute of ["name", "id"]) {
    const hint = element.getAttribute(attribute);
    if (hint && (hint.length > 512 || sensitiveHint(hint))) return true;
  }
  for (const attribute of ["aria-label", "title", "autocomplete"]) {
    const hint = element.getAttribute(attribute);
    if (hint === null) continue;
    if (hint.length > 512) return true;
    hints.push(hint);
  }
  const labels = element.labels;
  if (labels && labels.length > 4) return true;
  const budget = { remaining: 64, truncated: false };
  for (const label of labels ?? []) {
    const hint = readPublicText(label, budget);
    // Unreadable/filtered labels cannot establish an ordinary public field.
    if (hint === undefined) return true;
    hints.push(hint);
  }
  const references = element.getAttribute("aria-labelledby");
  if (references !== null) {
    if (references.length > 512) return true;
    const identifiers = references.trim().split(/\s+/);
    if (identifiers.length > 4) return true;
    for (const identifier of identifiers) {
      const label = element.ownerDocument.getElementById(identifier);
      const hint = label && readPublicText(label, budget);
      if (!hint) return true;
      hints.push(hint);
    }
  }
  return hints.some((hint) => sensitiveHint(hint) || sensitiveContent(hint));
}

/** Read only a native changed control; never traverse other control values. */
export function readChangedText(
  element: Element,
): ProductInteractionText | undefined {
  if (
    !(
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        ["text", "search"].includes(element.type))
    ) ||
    !element.isConnected ||
    !visibleElement(element)
  )
    return;
  // SDK composers already contribute messages to agent history. This guard only
  // omits their text; generic interaction capture still tracks focus/attribution.
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("data-copilotkit")) return;
    const root = current.getRootNode();
    current =
      current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  if (hasSensitiveFieldHint(element)) return { omitted: "sensitive-field" };
  const value = element.value;
  if (value.length > 1024 || new TextEncoder().encode(value).byteLength > 2048)
    return { omitted: "size-limit" };
  if (sensitiveContent(value)) return { omitted: "sensitive-content" };
  return { value };
}
