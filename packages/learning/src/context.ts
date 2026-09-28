import type { ProductInteractionContext } from "./types";
import { describeTarget, readPublicText, visibleElement } from "./privacy";
import type { ReadBudget } from "./privacy";
import { readControlText } from "./text";

type Kind = ProductInteractionContext["items"][number]["kind"];
const priority: { [key in Kind]: number } = {
  status: 0,
  heading: 1,
  group: 4,
  region: 6,
  content: 7,
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

/** A bounded semantic observation, including visible task state and short prose. */
export function describeContext(
  target: Element,
  scope = contextScope(target),
  options: { captureTextValues?: boolean; editing?: WeakSet<Element> } = {},
): ProductInteractionContext | undefined {
  if (!scope?.isConnected || !visibleElement(scope)) return;
  const budget: ReadBudget = { remaining: 256, truncated: false };
  const context: ProductInteractionContext = { items: [] };
  const seen = new Set<Element>();
  const scores = new WeakMap<
    ProductInteractionContext["items"][number],
    number
  >();
  const nearbyGroup = target.closest("fieldset,form");

  function add(element: Element, kind: Kind) {
    if (
      seen.has(element) ||
      !element.isConnected ||
      !scope?.contains(element) ||
      !visibleElement(element)
    )
      return;
    let ancestor: Element | null = element;
    while (ancestor) {
      if (ancestor.hasAttribute("data-copilotkit")) return;
      const root = ancestor.getRootNode();
      ancestor =
        ancestor.parentElement ??
        (root instanceof ShadowRoot ? root.host : null);
    }
    seen.add(element);
    const descriptor = describeTarget(element, true, budget);
    if (kind === "content")
      descriptor.accessibleName = readPublicText(element, budget, true);
    const text =
      kind === "control" && options.captureTextValues !== false
        ? options.editing?.has(element)
          ? { omitted: "in-progress" as const }
          : readControlText(element, budget)
        : undefined;
    if (!descriptor.accessibleName && !descriptor.state && !text) return;
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
    const item = { kind, ...descriptor, ...(text && { text }) };
    const score =
      kind === "control" && element === target
        ? 2
        : kind === "content" && element.hasAttribute("data-learning-context")
          ? 3
          : kind === "control" && nearbyGroup?.contains(element)
            ? 4
            : priority[kind];
    scores.set(item, score);
    context.items.push(item);
    context.items.sort((left, right) => scores.get(left)! - scores.get(right)!);
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

  const controlSelector =
    'input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],[aria-checked],[aria-expanded],[aria-pressed],[aria-selected]';
  if (target.matches(controlSelector)) add(target, "control");
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
    if (node.matches("script,style,noscript,[data-copilotkit]")) return;
    if (node.matches("h1,h2,h3,h4,h5,h6,[role=heading]")) add(node, "heading");
    else if (node.matches("[role=status],[role=alert],output"))
      add(node, "status");
    else if (node.hasAttribute("data-learning-context")) add(node, "content");
    else if (node.matches("fieldset,form")) add(node, "group");
    else if (node.matches(controlSelector)) add(node, "control");
    else if (node.matches("p,li,th,td,dt,dd")) add(node, "content");
    // Values above use their own bounded reader; do not duplicate editable text.
    if (node.matches("input,textarea,select,[contenteditable]")) return;
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
