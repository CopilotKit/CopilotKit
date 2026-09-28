import type { ProductControlState, ProductInteractionTarget } from "./types";
import { describePage } from "./page";

const sensitiveSelector = [
  "[data-private]",
  "[data-sensitive]",
  "[data-learning-ignore]",
  '[data-copilotkit-learning="ignore"]',
  ".ph-no-capture",
  ".ph-sensitive",
  "[hidden]",
  '[aria-hidden="true"]',
  '[type="password"]',
  '[type="hidden"]',
  '[type="email"]',
  '[type="tel"]',
  "[inert]",
].join(",");

const sensitiveAutocomplete =
  /(?:^|\s)(?:current-password|new-password|one-time-code|cc-\S+|name|given-name|family-name|additional-name|nickname|email|tel\S*|street-address|address-line\d|postal-code|bday\S*)(?:\s|$)/i;
const sensitiveIdentifier =
  /password|passwd|secret|token|credit.?card|card.?number|cvv|cvc|ssn|social.?security|email|phone/i;

/** Walk across open shadow roots too, so a private host protects its descendants. */
export function isSensitive(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (
      current.matches(sensitiveSelector) ||
      sensitiveAutocomplete.test(current.getAttribute("autocomplete") ?? "") ||
      sensitiveIdentifier.test(current.getAttribute("name") ?? "") ||
      sensitiveIdentifier.test(current.id)
    ) {
      return true;
    }
    const root: Node = current.getRootNode();
    current =
      current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

const inferredRoles: Record<string, string> = {
  button: "button",
  a: "link",
  select: "combobox",
  textarea: "textbox",
  form: "form",
  fieldset: "group",
  output: "status",
  main: "main",
  nav: "navigation",
  dialog: "dialog",
};

function safeMetadata(
  value: string | null,
  allowCurrency = false,
): string | undefined {
  if (!value || value.length > 512) return;
  const label = value?.trim();
  // Only explicitly approved context may exempt a complete currency token from
  // the numeric heuristic. Bound integer digits; never consume a prefix of a
  // longer account/card/phone sequence. Other metadata keeps its original rule.
  const numericText = allowCurrency
    ? label.replace(
        /(?<![\p{L}\p{N}\p{M}_])(?:[$€£¥]|(?:USD|EUR|GBP|CAD|AUD|CHF|JPY)\s+)\s*-?(?:\d{1,3},\d{3}|\d{1,6})(?:\.\d{2})?(?![\p{L}\p{N}\p{M}_]|[,.]\d|[\s()+-]*\d)/giu,
        "[currency]",
      )
    : label;
  // Basic filtering, not anonymization: applications must mark private controls.
  // Include separated phone/card numbers and common credential labels as well.
  if (
    !label ||
    label.length > 80 ||
    sensitiveIdentifier.test(label) ||
    /@|https?:\/\/|www\.|[\r\n]/i.test(label) ||
    (allowCurrency ? /(?:\d[\s(),+.-]*){4,}/ : /(?:\d[\s()+.-]*){4,}/).test(
      numericText,
    )
  )
    return;
  return label;
}

function safeIdentifier(value: string | null): string | undefined {
  const label = safeMetadata(value);
  return label && /^[a-z][a-z0-9_.:-]{0,63}$/i.test(label) ? label : undefined;
}

export interface ReadBudget {
  remaining: number;
  truncated: boolean;
}

/** Unlike innerText/textContent, this never enters private or editable descendants. */
export function visibleElement(element: Element): boolean {
  if (isSensitive(element)) return false;
  let current: Element | null = element;
  for (let depth = 0; current && depth < 64; depth++) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    )
      return false;
    const root = current.getRootNode();
    current =
      current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return !current;
}

function readableElement(element: Element): boolean {
  return (
    visibleElement(element) &&
    !element.closest(
      "textarea,input,[contenteditable]:not([contenteditable=false]),script,style,noscript",
    )
  );
}

export function readPublicText(
  element: Element,
  budget: ReadBudget = { remaining: 64, truncated: false },
  approvedContext = false,
): string | undefined {
  let value = "";
  let complete = true;
  function visit(node: Node) {
    if (budget.remaining-- <= 0) {
      budget.truncated = true;
      complete = false;
      return;
    }
    if (node instanceof Element && !readableElement(node)) return;
    if (node instanceof Text) {
      if (node.length + value.length > 512) {
        budget.truncated = true;
        complete = false;
        return;
      }
      value += node.data;
    }
    // Reject overlong content rather than truncating away a sensitive suffix.
    if (value.length > 512) return;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (budget.remaining <= 0 || value.length > 512) {
        budget.truncated = true;
        complete = false;
        break;
      }
      visit(child);
    }
  }
  if (!readableElement(element)) return;
  visit(element);
  return complete
    ? safeMetadata(
        value.replace(/\s+/g, " "),
        approvedContext && element.hasAttribute("data-learning-context"),
      )
    : undefined;
}

function accessibleName(
  element: Element,
  budget: ReadBudget,
): string | undefined {
  if (element.hasAttribute("aria-label"))
    return safeMetadata(element.getAttribute("aria-label"));
  const references = element.getAttribute("aria-labelledby");
  if (references !== null) {
    if (references.length > 512) return;
    const identifiers = references.trim().split(/\s+/);
    if (identifiers.length > 4) {
      budget.truncated = true;
      return;
    }
    const labels = identifiers.flatMap((reference) => {
      const node = element.ownerDocument.getElementById(reference);
      const label = node && readPublicText(node, budget);
      return label ? [label] : [];
    });
    return safeMetadata(labels.join(" "));
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const labels = element.labels;
    if (labels?.length) {
      if (labels.length > 4) {
        budget.truncated = true;
        return;
      }
      const names: string[] = [];
      for (let index = 0; index < Math.min(labels.length, 4); index++) {
        const name = readPublicText(labels[index], budget);
        if (name) names.push(name);
      }
      return safeMetadata(names.join(" "));
    }
  }
  if (element instanceof HTMLFieldSetElement) {
    const legend = element.firstElementChild;
    if (legend?.tagName === "LEGEND") return readPublicText(legend, budget);
  }
  if (element.hasAttribute("title"))
    return safeMetadata(element.getAttribute("title"));
  if (
    element.matches(
      'button,a,summary,option,h1,h2,h3,h4,h5,h6,legend,output,[role="button"],[role="link"],[role="option"],[role="heading"],[role="status"],[role="alert"],[data-learning-context]',
    )
  ) {
    return readPublicText(element, budget);
  }
}

function describeState(
  element: Element,
  includeName: boolean,
  budget: ReadBudget,
): ProductControlState | undefined {
  const state: ProductControlState = {};
  for (const key of [
    "checked",
    "expanded",
    "pressed",
    "selected",
    "disabled",
  ] as const) {
    const raw = element.getAttribute(`aria-${key}`);
    if (raw === "true" || raw === "false") state[key] = raw === "true";
    else if (raw === "mixed" && (key === "checked" || key === "pressed"))
      state[key] = "mixed";
  }
  if (
    element instanceof HTMLInputElement &&
    ["checkbox", "radio"].includes(element.type)
  ) {
    state.checked = element.indeterminate ? "mixed" : element.checked;
  }
  if (element.hasAttribute("disabled")) state.disabled = true;
  if (includeName && element instanceof HTMLSelectElement) {
    state.selectedOptions = [];
    for (
      let index = 0;
      index < Math.min(element.selectedOptions.length, 4);
      index++
    ) {
      const option = element.selectedOptions[index];
      const label = visibleElement(option)
        ? option.hasAttribute("label")
          ? safeMetadata(option.getAttribute("label"))
          : readPublicText(option, budget)
        : undefined;
      if (label) state.selectedOptions.push(label);
    }
  }
  return Object.keys(state).length ? state : undefined;
}

export function describeTarget(
  element: Element,
  includeName: boolean,
  budget: ReadBudget = { remaining: 64, truncated: false },
): ProductInteractionTarget {
  const tagName = element.tagName.toLowerCase();
  const inputRoles: { [type: string]: string } = {
    checkbox: "checkbox",
    radio: "radio",
    button: "button",
    submit: "button",
    reset: "button",
    text: "textbox",
    email: "textbox",
    tel: "textbox",
    url: "textbox",
    password: "textbox",
    number: "spinbutton",
    range: "slider",
    search: "searchbox",
  };
  const inputRole =
    element instanceof HTMLInputElement ? inputRoles[element.type] : undefined;
  const rawRole =
    element.getAttribute("role") ??
    inputRole ??
    (/^h[1-6]$/.test(tagName) ? "heading" : inferredRoles[tagName]);
  const role = rawRole && /^[a-z-]{1,32}$/.test(rawRole) ? rawRole : undefined;
  const result: ProductInteractionTarget = { tagName, ...(role && { role }) };
  const name = safeIdentifier(element.getAttribute("name"));
  const learningId = safeIdentifier(element.getAttribute("data-learning-id"));
  if (name) result.name = name;
  if (learningId) result.learningId = learningId;
  if (includeName) {
    const label = accessibleName(element, budget);
    if (label) result.accessibleName = label;
  }
  const state = describeState(element, includeName, budget);
  if (state) result.state = state;
  return result;
}

export function parsePrefixes(
  prefixes: readonly string[],
  base: string,
): URL[] {
  return prefixes
    .flatMap((prefix) => {
      try {
        const url = new URL(prefix, base);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password)
          return [];
        url.search = "";
        url.hash = "";
        url.pathname = url.pathname.replace(/\/$/, "") || "/";
        return [url];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.pathname.length - a.pathname.length);
}

function matchesPrefix(url: URL, prefix: URL): boolean {
  return (
    url.origin === prefix.origin &&
    (prefix.pathname === "/" ||
      url.pathname === prefix.pathname ||
      url.pathname.startsWith(`${prefix.pathname}/`))
  );
}

export function safeRequestUrl(
  raw: string,
  base: string,
  allowed: URL[],
  excluded: URL[],
): string | undefined {
  try {
    const url = new URL(raw, base);
    if (
      url.username ||
      url.password ||
      excluded.some((prefix) => matchesPrefix(url, prefix))
    )
      return;
    const match = allowed.find((prefix) => matchesPrefix(url, prefix));
    if (!match) return;
    const page = describePage(url);
    if ("pathname" in page) return `${url.origin}${page.pathname}`;
    // Oversized paths must not reveal an unchecked prefix of the raw request.
    // The configured prefix is useful only after applying the same filtering.
    const prefix = describePage(match);
    return "pathname" in prefix
      ? `${match.origin}${prefix.pathname}`
      : undefined;
  } catch {
    return;
  }
}
