import axe from "axe-core";

export interface Finding {
  rule: string;
  target: string;
  detail: string;
}
export const wcagTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

/** A structural address: generated React/Vue/Angular IDs never enter the baseline. */
export function targetOf(el: Element, root: Element): string {
  if (el === root) return ":scope";
  const parts: string[] = [];
  for (
    let node: Element | null = el;
    node && node !== root;
    node = node.parentElement
  ) {
    const siblings = Array.from(node.parentElement?.children ?? []).filter(
      (x) => x.localName === node!.localName,
    );
    parts.unshift(
      `${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`,
    );
  }
  return parts.join(" > ");
}

/** Report classification only: extra occurrences are new, removals are allowed. */
export function classifyKnown(
  actual: string[],
  reviewed: string[],
): { known: string[]; new: string[] } {
  const remaining = [...reviewed];
  const result: { known: string[]; new: string[] } = { known: [], new: [] };
  for (const finding of actual) {
    const index = remaining.indexOf(finding);
    if (index < 0) result.new.push(finding);
    else {
      remaining.splice(index, 1);
      result.known.push(finding);
    }
  }
  return result;
}

/** stderr survives Vitest's silent console configuration in React and Angular. */
export function warnFindings(label: string, findings: Finding[]): void {
  if (findings.length)
    process.stderr.write(
      `[a11y warning] ${label}: ${findings.length} findings; ${[...new Set(findings.map((x) => x.rule))].join(", ")}\n`,
    );
}

export async function collectAxeFindings(
  root: Element,
  options: {
    rules?: axe.RuleObject;
    exclude?: string[];
  } = {},
): Promise<Finding[]> {
  const result = await axe.run(
    { include: [root], exclude: options.exclude?.map((x) => [x]) ?? [] },
    {
      runOnly: { type: "tag", values: wcagTags },
      elementRef: true,
      rules: { "color-contrast": { enabled: false }, ...options.rules },
    },
  );
  const findings = result.violations.flatMap((v) =>
    v.nodes.map((node) => ({
      rule: v.id,
      target: node.element ? targetOf(node.element, root) : String(node.target),
      detail: v.help,
    })),
  );

  return findings;
}

/** Warning-only entry point. Enforcement is deliberately not implemented. */
export async function expectNoAxeViolations(
  root: Element,
  options: Parameters<typeof collectAxeFindings>[1] = {},
): Promise<Finding[]> {
  const findings = await collectAxeFindings(root, options);
  warnFindings("axe", findings);
  return findings;
}

/** Install before rendering, remove before scanning. React delegates clicks at the
 * root, so inline/computed cursor:pointer and onclick are also inspected below.
 * DOM does not expose arbitrary pre-existing addEventListener registrations. */
export function observeClicks(): () => ReadonlySet<Element> {
  const clicks = new Set<Element>();
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (type === "click" && this instanceof Element) clicks.add(this);
    return original.call(this, type, listener, options);
  };
  return () => {
    EventTarget.prototype.addEventListener = original;
    return clicks;
  };
}

const interactiveRoles = new Set([
  "button",
  "link",
  "checkbox",
  "combobox",
  "gridcell",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "radiogroup",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "tablist",
  "textbox",
  "treeitem",
  "dialog",
  "alertdialog",
]);
const actionableRoles = new Set([
  "button",
  "link",
  "checkbox",
  "combobox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);
const idrefs = [
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
  "headers",
  "for",
  "list",
  "form",
];

function roleOf(el: Element): string {
  const explicit = el.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  if (
    el.matches(
      "button,input[type=button],input[type=submit],input[type=reset],summary",
    )
  )
    return "button";
  if (el.matches("a[href],area[href]")) return "link";
  if (el.matches("input[type=checkbox]")) return "checkbox";
  if (el.matches("input[type=radio]")) return "radio";
  if (el.matches("input[type=range]")) return "slider";
  if (el.matches("input[type=number]")) return "spinbutton";
  if (el.matches("input[type=search]")) return "searchbox";
  if (el.matches("input:not([type=hidden]),textarea")) return "textbox";
  if (el.matches("select"))
    return el.hasAttribute("multiple") ? "listbox" : "combobox";
  return "";
}
function displayed(el: Element): boolean {
  const view = el.ownerDocument.defaultView!;
  if (view.getComputedStyle(el).visibility === "hidden") return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (view.getComputedStyle(node).display === "none") return false;
  }
  return true;
}
function focusable(el: Element): boolean {
  return (
    !el.matches(":disabled,input[type=hidden]") &&
    !el.closest("[hidden],[inert]") &&
    displayed(el) &&
    (el.hasAttribute("tabindex") ||
      el.matches(
        "button,input:not([type=hidden]),select,textarea,a[href],area[href],summary,[contenteditable]:not([contenteditable=false])",
      ))
  );
}

/** No framework APIs: native/ARIA semantics, axe's accessible-name computation,
 * observed click listeners and pointer affordances on the rendered DOM. */
export function checkDOM(
  root: Element,
  clicks: ReadonlySet<Element> = new Set(),
  ignoreClicks: Element[] = [],
): Finding[] {
  const findings: Finding[] = [];
  const add = (el: Element, rule: string, detail: string) =>
    findings.push({ rule, target: targetOf(el, root), detail });
  axe.setup(root.ownerDocument);
  try {
    for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
      const hidden =
        !!el.closest('[aria-hidden="true"],[hidden],[inert]') || !displayed(el);
      const role = roleOf(el);
      // The adapters explicitly exclude renderer hosts. A direct listener on a
      // clickable ancestor must still be checked when it also owns buttons.
      const clickable =
        el !== root &&
        !ignoreClicks.includes(el) &&
        (clicks.has(el) ||
          ((el as HTMLElement).onclick !== null &&
            (el as HTMLElement).onclick !== undefined) ||
          el.hasAttribute("onclick") ||
          (el as HTMLElement).style.cursor === "pointer");
      if (clickable && !el.matches(":disabled") && !hidden) {
        if (!focusable(el))
          add(el, "click-focusable", "Click target cannot take focus");
        if (!actionableRoles.has(role))
          add(el, "click-role", "Click target has no interactive role");
      }
      if (
        !hidden &&
        interactiveRoles.has(role) &&
        !axe.commons.text.accessibleText(el).trim()
      )
        add(el, "interactive-name", `Unnamed ${role}`);
      if (focusable(el) && el.closest('[aria-hidden="true"]'))
        add(el, "hidden-focus", "Focusable content inside aria-hidden");
      for (const attr of idrefs) {
        for (const id of (el.getAttribute(attr) ?? "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)) {
          if (!el.ownerDocument.getElementById(id))
            add(el, "id-reference", `Unresolved ${attr}`);
        }
      }
      if (el.getAttribute("aria-invalid") === "true") {
        const refs = ["aria-describedby", "aria-errormessage"].flatMap((a) =>
          (el.getAttribute(a) ?? "").split(/\s+/),
        );
        if (
          !refs.some((id) =>
            el.ownerDocument.getElementById(id)?.textContent?.trim(),
          )
        )
          add(
            el,
            "error-reference",
            "Invalid field has no referenced error message",
          );
      }
    }
  } finally {
    axe.teardown();
  }
  return findings;
}
