import type { ProductInteractionContext } from "./types";
import { describeTarget, readPublicText, visibleElement } from "./privacy";
import type { ReadBudget } from "./privacy";

type Kind = ProductInteractionContext["items"][number]["kind"];
const priority: { [key in Kind]: number } = {
  status: 0,
  heading: 1,
  group: 2,
  region: 3,
  content: 4,
  control: 5,
};

export function contextScope(target: Element): Element | undefined {
  if (!target.isConnected) return target.ownerDocument.body ?? undefined;
  return (
    target.closest('main,[role="main"],dialog,[role="dialog"]') ??
    target.closest(
      'form,section[aria-label],section[aria-labelledby],[role="region"]',
    ) ??
    target.ownerDocument.body ??
    undefined
  );
}

/** One bounded semantic observation; never a DOM or arbitrary text snapshot. */
export function describeContext(
  target: Element,
  scope = contextScope(target),
): ProductInteractionContext | undefined {
  if (!scope?.isConnected || !visibleElement(scope)) return;
  const budget: ReadBudget = { remaining: 256, truncated: false };
  const context: ProductInteractionContext = { items: [] };
  const seen = new Set<Element>();

  function add(element: Element, kind: Kind) {
    if (seen.has(element) || !visibleElement(element)) return;
    seen.add(element);
    const descriptor = describeTarget(element, true, budget);
    if (kind === "content")
      descriptor.accessibleName = readPublicText(element, budget, true);
    if (!descriptor.accessibleName && !descriptor.state) return;
    if (descriptor.role === "radio" && descriptor.state?.checked === false)
      return;
    if (kind === "heading") {
      context.items = context.items.filter(
        (item) =>
          !(
            item.kind === "region" &&
            item.accessibleName === descriptor.accessibleName
          ),
      );
    }
    context.items.push({ kind, ...descriptor });
    context.items.sort(
      (left, right) => priority[left.kind] - priority[right.kind],
    );
    // Reserve the truncation marker so the published context always fits.
    while (
      context.items.length > 8 ||
      new TextEncoder().encode(JSON.stringify({ ...context, truncated: true }))
        .byteLength > 2048
    ) {
      context.items.pop();
      budget.truncated = true;
    }
  }

  add(scope, "region");
  let group = target.isConnected ? target.closest("fieldset,form") : null;
  for (let index = 0; group && index < 4; index++) {
    add(group, "group");
    group = group.parentElement?.closest("fieldset,form") ?? null;
  }

  function visit(node: Node) {
    if (budget.remaining-- <= 0) {
      budget.truncated = true;
      return;
    }
    if (!(node instanceof Element) || !visibleElement(node)) return;
    if (
      node.matches(
        "input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable]:not([contenteditable=false]),script,style,noscript",
      )
    )
      return;
    if (node.matches("h1,h2,h3,h4,h5,h6,[role=heading]")) add(node, "heading");
    else if (node.matches("[role=status],[role=alert],output"))
      add(node, "status");
    else if (node.hasAttribute("data-learning-context")) add(node, "content");
    else if (node.matches("fieldset,form")) add(node, "group");
    else if (
      node.matches(
        "select,input[type=checkbox],input[type=radio],[aria-checked],[aria-expanded],[aria-pressed],[aria-selected]",
      )
    )
      add(node, "control");
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (budget.remaining <= 0) {
        budget.truncated = true;
        break;
      }
      visit(child);
    }
  }
  visit(scope);
  if (budget.truncated) context.truncated = true;
  return context.items.length || context.truncated ? context : undefined;
}
