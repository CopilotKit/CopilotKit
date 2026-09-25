/** A bounded view of the current page, built only when the agent asks for it. */
export interface AutopilotPageMap {
  path: string;
  title: string;
  headings: string[];
  text: string;
  controls: AutopilotControl[];
  coverage: {
    visitedTextNodes: number;
    truncated: boolean;
    maxCharacters: number;
  };
}

export interface AutopilotControl {
  ref: string;
  kind: "link" | "button" | "input" | "select" | "textarea";
  name: string;
  form?: string;
  value?: string;
  disabled?: boolean;
  required?: boolean;
  href?: string;
  options?: Array<{ value: string; label: string }>;
}

type StoredTarget = { element: Element; fingerprint: string; path: string };

const PRIVATE_SELECTOR =
  '[data-copilot-private], [hidden], [inert], [aria-hidden="true"]';
const CONTROL_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, [data-autopilot-custom-select]';
const MAX_TEXT_NODES = 350;
const MAX_CONTROLS = 65;
const MAX_SEARCH_CONTROLS = 5_000;
const MAX_CHARACTERS = 12_000;

function permitted(element: Element): boolean {
  if (element.closest(PRIVATE_SELECTOR)) return false;
  if (element.matches('input[type="password"], input[type="file"]'))
    return false;
  if (element.closest("script, style, template, noscript")) return false;
  if (
    typeof element.getClientRects === "function" &&
    element.getClientRects().length === 0
  )
    return false;
  return true;
}

function safeText(element: Element, limit = 120): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let length = 0;
  while (walker.nextNode() && length < limit) {
    const node = walker.currentNode;
    if (!node.parentElement || !permitted(node.parentElement)) continue;
    const value = node.textContent?.trim().replace(/\s+/g, " ") ?? "";
    if (!value) continue;
    parts.push(value);
    length += value.length + 1;
  }
  return parts.join(" ").slice(0, limit).trim();
}

function accessibleName(element: Element): string {
  const aria = element.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const names = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((item): item is HTMLElement => !!item && permitted(item));
    if (names.length)
      return names
        .map((item) => safeText(item))
        .join(" ")
        .trim();
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const labels = [...(element.labels ?? [])].filter(permitted);
    if (labels.length)
      return labels
        .map((label) => safeText(label))
        .join(" ")
        .trim();
    return element.getAttribute("placeholder")?.trim() ?? element.name;
  }
  return safeText(element) || element.getAttribute("title") || "";
}

function identity(element: Element): string {
  const record =
    element
      .closest("[data-autopilot-record-id]")
      ?.getAttribute("data-autopilot-record-id") ?? "";
  const draft =
    element
      .closest("[data-autopilot-draft-id]")
      ?.getAttribute("data-autopilot-draft-id") ?? "";
  const version =
    element
      .closest("[data-autopilot-record-version]")
      ?.getAttribute("data-autopilot-record-version") ?? "";
  const form = element.closest("form");
  return JSON.stringify({
    tag: element.tagName,
    type: element.getAttribute("type"),
    name: element.getAttribute("name"),
    accessibleName: accessibleName(element),
    href: element.getAttribute("href"),
    form: form?.getAttribute("aria-label") ?? form?.getAttribute("id") ?? "",
    record,
    draft,
    version,
  });
}

/**
 * Ref identities are tied to one live DOM element, route, and semantic target.
 * A reused element for another record does not inherit its earlier permission.
 * Input values deliberately are not part of identity: an operation's own fill
 * cannot invalidate its next field by merely dispatching an input event.
 */
export class BrowserPageMap {
  private nextRef = 1;
  private targets = new Map<string, StoredTarget>();
  private elementRefs = new WeakMap<Element, string>();

  read(
    root: Element | null = document.querySelector("[data-copilot-page]") ??
      document.querySelector("main"),
  ): AutopilotPageMap {
    if (!root || !permitted(root)) throw new Error("No readable page content");
    const path = window.location.pathname;
    const headings = [...root.querySelectorAll("h1, h2, h3")]
      .filter(permitted)
      .slice(0, 35)
      .map((element) => safeText(element));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textParts: string[] = [];
    let visitedTextNodes = 0;
    let characters = 0;
    let truncated = false;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || !permitted(parent)) continue;
      const value = node.textContent?.trim().replace(/\s+/g, " ") ?? "";
      if (!value) continue;
      visitedTextNodes++;
      if (
        visitedTextNodes > MAX_TEXT_NODES ||
        characters + value.length > MAX_CHARACTERS
      ) {
        truncated = true;
        break;
      }
      textParts.push(value);
      characters += value.length + 1;
    }
    const candidates = [...root.querySelectorAll(CONTROL_SELECTOR)].filter(
      permitted,
    );
    const controls = candidates
      .slice(0, MAX_CONTROLS)
      .map((element) => this.describeControl(element));
    return {
      path,
      title: document.title,
      headings,
      text: textParts.join(" "),
      controls,
      coverage: {
        visitedTextNodes,
        truncated: truncated || candidates.length > MAX_CONTROLS,
        maxCharacters: MAX_CHARACTERS,
      },
    };
  }

  findControls(
    query: string,
    root: Element | null = document.querySelector("[data-copilot-page]") ??
      document.querySelector("main"),
  ): AutopilotControl[] {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || needle.length > 120)
      throw new Error("Provide a short control name");
    if (!root || !permitted(root)) throw new Error("No readable page content");
    const candidates = root.querySelectorAll(CONTROL_SELECTOR);
    if (candidates.length > MAX_SEARCH_CONTROLS)
      throw new Error("Too many controls to search; narrow the page first");
    const matches: AutopilotControl[] = [];
    for (const element of candidates) {
      if (!permitted(element)) continue;
      const form = element.closest("form");
      const formName = form && permitted(form) ? accessibleName(form) : "";
      if (
        !accessibleName(element).toLocaleLowerCase().includes(needle) &&
        !formName.toLocaleLowerCase().includes(needle)
      )
        continue;
      matches.push(this.describeControl(element));
      if (matches.length === 15) break;
    }
    return matches;
  }

  resolve(ref: string): Element {
    const target = this.targets.get(ref);
    if (
      !target ||
      target.path !== window.location.pathname ||
      !target.element.isConnected ||
      !permitted(target.element) ||
      identity(target.element) !== target.fingerprint
    ) {
      throw new Error(
        "Control changed or is no longer available; read the page again",
      );
    }
    return target.element;
  }

  private describeControl(element: Element): AutopilotControl {
    const fingerprint = identity(element);
    let ref = this.elementRefs.get(element);
    if (!ref || this.targets.get(ref)?.fingerprint !== fingerprint) {
      ref = `c${this.nextRef++}`;
      this.elementRefs.set(element, ref);
    }
    this.targets.set(ref, {
      element,
      fingerprint,
      path: window.location.pathname,
    });
    const kind: AutopilotControl["kind"] = element.hasAttribute(
      "data-autopilot-custom-select",
    )
      ? "select"
      : element instanceof HTMLAnchorElement
        ? "link"
        : element instanceof HTMLButtonElement
          ? "button"
          : element instanceof HTMLSelectElement
            ? "select"
            : element instanceof HTMLTextAreaElement
              ? "textarea"
              : "input";
    const control: AutopilotControl = {
      ref,
      kind,
      name: accessibleName(element),
    };
    const form = element.closest("form");
    if (form && permitted(form)) control.form = accessibleName(form);
    if (element instanceof HTMLAnchorElement) {
      const href = element.getAttribute("href");
      if (href) {
        const url = new URL(href, window.location.href);
        control.href =
          url.origin === window.location.origin ? url.pathname : "[external]";
      }
    }
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )
      control.value = element.value;
    if (element.hasAttribute("data-autopilot-custom-select")) {
      control.value = element.getAttribute("data-autopilot-selected") ?? "";
      control.options = [...element.querySelectorAll("[data-autopilot-option]")]
        .filter(permitted)
        .slice(0, 40)
        .map((option) => ({
          value: option.getAttribute("data-autopilot-option") ?? "",
          label: safeText(option),
        }));
    }
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLButtonElement
    )
      control.disabled = element.disabled;
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    )
      control.required = element.required;
    if (element instanceof HTMLSelectElement)
      control.options = [...element.options].slice(0, 40).map((option) => ({
        value: option.value,
        label: option.label.slice(0, 120),
      }));
    return control;
  }
}
