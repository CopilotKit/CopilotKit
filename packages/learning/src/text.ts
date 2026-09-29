import type { ProductInteractionText } from "./types";
import { readPublicText, visibleElement } from "./privacy";
import type { ReadBudget } from "./privacy";

const sensitiveFieldHint =
  /\b(?:user[\s_.-]*name|(?:full|first|last|given|family|display|legal)[\s_.-]*name|(?:street|home|postal|billing|shipping|mailing)[\s_.-]*address|address|e[\s_.-]*mail|phone|mobile|password|passwd|passcode|secret|token|api[\s_.-]*key|credit[\s_.-]*card|card[\s_.-]*number|cvv|cvc|ssn|social[\s_.-]*security|birth[\s_.-]*day|date[\s_.-]*of[\s_.-]*birth|dob)\b/i;

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
  element: Element,
  budget: ReadBudget = { remaining: 64, truncated: false },
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
  const labels =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? element.labels
      : undefined;
  if (labels && labels.length > 4) return true;
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

const textInputTypes = new Set([
  "text",
  "search",
  "number",
  "range",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

/** Read a public control at any observation point, not only after an edit. */
export function readControlText(
  element: Element,
  budget: ReadBudget = { remaining: 64, truncated: false },
): ProductInteractionText | undefined {
  const editable = element.matches(
    '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]',
  );
  if (
    !(
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        textInputTypes.has(element.type)) ||
      editable
    ) ||
    !element.isConnected ||
    !visibleElement(element)
  )
    return;
  // SDK composers already contribute messages to agent history.
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute("data-copilotkit")) return;
    const root = current.getRootNode();
    current =
      current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  if (hasSensitiveFieldHint(element, budget))
    return { omitted: "sensitive-field" };

  let value = "";
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement
  ) {
    value = element.value;
  } else {
    let omitted: "sensitive-field" | "size-limit" | undefined;
    function visit(node: Node) {
      if (omitted) return;
      if (budget.remaining-- <= 0) {
        budget.truncated = true;
        omitted = "size-limit";
        return;
      }
      if (node instanceof Element && node !== element) {
        if (!visibleElement(node) || node.hasAttribute("data-copilotkit")) {
          // A partially redacted editor could falsely imply a complete value.
          omitted = "sensitive-field";
          return;
        }
        if (node.matches("input,textarea,select,script,style,noscript")) return;
        if (node.matches("br")) value += "\n";
        else if (node.matches("p,div,li") && value && !value.endsWith("\n"))
          value += "\n";
      }
      if (node instanceof Text) {
        if (value.length + node.length > 1024) {
          omitted = "size-limit";
          return;
        }
        value += node.data;
      }
      for (
        let child = node.firstChild;
        child && !omitted;
        child = child.nextSibling
      )
        visit(child);
    }
    visit(element);
    if (omitted) return { omitted };
  }

  if (value.length > 1024 || new TextEncoder().encode(value).byteLength > 2048)
    return { omitted: "size-limit" };
  // Native date/time controls normalize their values. A valid task deadline is
  // useful context; field hints still exclude birthdays and other private dates.
  const nativeDate =
    element instanceof HTMLInputElement &&
    ["date", "time", "datetime-local", "month", "week"].includes(
      element.type,
    ) &&
    /^(?:\d{4}-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?)?|\d{4}-W\d{2}|\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/.test(
      value,
    );
  if (!nativeDate && sensitiveContent(value))
    return { omitted: "sensitive-content" };
  return { value };
}

export const readChangedText = readControlText;
