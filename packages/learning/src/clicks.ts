import { createRedactor, isCredentialKey } from "./redact";
import type { Redactor } from "./redact";
import { REDACTED } from "./types";
import type { ClickTarget, Emit, EnrichFn } from "./types";

const INTERACTIVE =
  'button, a[href], input, select, textarea, label, summary, [role], [data-copilotkit-action], [contenteditable]:not([contenteditable="false"])';
const RECOVERY_DISTANCE_PX = 5;
// `[role]` also matches containers such as role="main"; cap their text so one
// click cannot exceed the 16 KiB event limit and be dropped.
const MAX_TEXT_LENGTH = 1000;

/** `closest()` that continues through shadow roots to their hosts. */
function closestAcrossShadow(el: Element, selector: string) {
  let current: Element | null = el;
  while (current !== null) {
    const match = current.closest(selector);
    if (match !== null) return match;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

interface Described {
  element: Element;
  target: Omit<ClickTarget, "input">;
}

interface PointerOrigin {
  described: Described | null;
  x: number;
  y: number;
}

/**
 * Finds the nearest interactive element and retains its text, attributes, and value.
 * The explicit `data-copilotkit-ignore` opt-out still applies.
 */
export function describeTarget(el: Element, redact: Redactor) {
  if (closestAcrossShadow(el, "[data-copilotkit-ignore]") !== null) return null;
  const element = el.closest(INTERACTIVE) ?? el;
  // React and server markup can mirror the password into the value attribute.
  const password = redact.isPassword(element);
  const described: Described = {
    element,
    target: {
      tag: element.localName,
      role: element.getAttribute("role"),
      action: element.getAttribute("data-copilotkit-action"),
      text: (element.textContent ?? "").slice(0, MAX_TEXT_LENGTH),
      attributes: Object.fromEntries(
        Array.from(element.attributes, ({ name, value }) => [
          name,
          // Credential-named attributes (`data-api-key`) are redacted whole;
          // URL-valued ones (`href`, `action`, …) can carry credentials too.
          (password && name === "value") ||
          isCredentialKey(name.replace(/^data-/, ""))
            ? REDACTED
            : redact.url(value),
        ]),
      ),
      ...readControlValue(element, redact),
    },
  };
  return described;
}

const MAX_LABEL_LENGTH = 80;
// The text walk stops past these bounds. For a control's own text, that means no name.
const MAX_WALK_NODES = 1000;
const MAX_WALK_CHARS = 4 * MAX_LABEL_LENGTH;
// Controls whose name comes from their content. An explicit role overrides the
// tag, so `<li role="option">` qualifies and `<a href role="row">` does not.
const CONTROL_ROLE =
  /^(button|link|tab|menuitem(checkbox|radio)?|option|checkbox|switch|radio|treeitem)$/;
const CONTENTEDITABLE = '[contenteditable]:not([contenteditable="false"])';
const TEXT_ENTRY = `${CONTENTEDITABLE}, [role~=textbox], [role~=searchbox], [role~=combobox]`;
const EDITABLE = `input, textarea, select, ${TEXT_ENTRY}`;
// Card-like structure: a control containing it gets no name from its text,
// except for one lone paragraph, or headings inside `summary`.
const HEADING = "h1, h2, h3, h4, h5, h6, [role~=heading]";
const STRUCTURE = `${HEADING}, p, ul, ol, li, dl, table, article, section, blockquote`;
const SKIPPED = 'script, style, template, [hidden], [aria-hidden="true"]';
// Inline elements that do not separate words.
const PHRASING =
  /^(b|i|u|em|strong|mark|small|sub|sup|abbr|code|kbd|s|q|cite|dfn|var|time|data|bdi|bdo|wbr|span)$/;
const CAPTION_INPUT = /^(submit|button|reset|image)$/;
// Input types that do not hold typed text.
const NON_TEXT_INPUT =
  /^(submit|button|reset|image|checkbox|radio|range|color|file|hidden)$/;
// Includes bidi controls, zero-width characters, soft hyphens, word joiners,
// variation selectors, and tag characters.
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
// Quantifier bounds and run-start anchors keep each pattern linear. No
// lookbehind: a regex literal with one fails to parse in older Safari.
// A URL ends before trailing sentence punctuation.
const URL_LIKE =
  /(?:\b[a-z][\w+.-]{0,31}:\/\/|\bwww\.)[^\s<>"']*[^\s<>"'.,;:!?)]/gi;
const EMAIL =
  /[\p{L}\p{N}_.%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63})+/gu;
// JWTs, and three dotted segments that are each long or contain a digit, but
// not dotted names such as `settings.notifications.preferences`.
const JWT =
  /(^|[^\w-])(?:eyJ[\w-]*\.[\w-]*\.[\w-]*|[\w-]{16,}\.[\w-]{16,}\.[\w-]{16,}|(?=[\w-]*\d)[\w-]{8,}\.(?=[\w-]*\d)[\w-]{8,}\.(?=[\w-]*\d)[\w-]{8,})/g;
const TOKEN_RUN = /[\w+/=-]{24,}/g;

const roleOf = (element: Element) =>
  (element.getAttribute("role") ?? "").trim().split(/\s+/)[0]!.toLowerCase();

const idRefs = (element: Element, name: string) =>
  (element.getAttribute(name) ?? "").split(/\s+/).filter(Boolean);

const rootOf = (element: Element) => {
  const root = element.getRootNode();
  return root instanceof Document || root instanceof ShadowRoot ? root : null;
};

/** Buttons, links with `href`, `summary`, and elements with a control role. */
const isControl = (element: Element) => {
  const role = roleOf(element);
  return role
    ? CONTROL_ROLE.test(role)
    : element.matches("button, a[href], summary");
};

/** Text-like inputs, text areas, selects, and anything inside editable content or a text-entry role. */
const holdsValue = (element: Element) =>
  element instanceof HTMLInputElement
    ? !NON_TEXT_INPUT.test(element.type)
    : element.matches("textarea, select") ||
      element.closest(TEXT_ENTRY) !== null;

/**
 * The name an image contributes: `alt` of an `img`, or `aria-label` (else a
 * plain `<title>`) of an `svg` or `role="img"` element. `undefined` when the
 * element is not an image.
 */
function imageName(element: Element) {
  if (element.localName === "img") return element.getAttribute("alt");
  if (element.localName !== "svg" && roleOf(element) !== "img")
    return undefined;
  const title = Array.from(element.children).find(
    (child) => child.localName === "title" && child.childElementCount === 0,
  );
  return element.getAttribute("aria-label") ?? title?.textContent ?? null;
}

/**
 * Rendered text. Inline formatting joins words; other elements separate them.
 * Skips hidden subtrees, uses image names, and does
 * not walk into images. Yields nothing for editable content or editable
 * descendants. In `strict` mode (a control's own text) it also yields nothing
 * past the walk bounds, for card-like structure, and for text that looks like
 * separate fields: two `div`s that directly hold text, or three sibling
 * elements that each carry text.
 */
function safeText(root: Element, strict: boolean) {
  if (holdsValue(root)) return "";
  let text = "";
  let nodes = 0;
  let paragraphs = 0;
  // The first div that holds text; a second one means separate fields.
  let div: Element | undefined;
  const bearers = new Map<Node, Set<Node>>();
  const add = (part: string) => (text = (text + part).replace(/\s+/g, " "));
  // Marks `start` and its ancestors below root as carrying text. False once
  // three siblings do.
  const bear = (start: Node) => {
    if (!strict) return true;
    for (
      let child = start, parent = start.parentNode;
      child !== root && parent !== null;
      child = parent, parent = parent.parentNode
    ) {
      const siblings = bearers.get(parent) ?? new Set<Node>();
      bearers.set(parent, siblings);
      if (siblings.has(child)) break;
      if (siblings.add(child).size > 2) return false;
    }
    return true;
  };
  let node: Node | null = root.firstChild;
  while (node !== null) {
    if (++nodes > MAX_WALK_NODES || text.length > MAX_WALK_CHARS) {
      if (strict) return "";
      break;
    }
    let descend = false;
    if (node instanceof Text) {
      const parent = node.parentNode as Element;
      // The block that holds this text, through inline elements.
      let holder = parent;
      while (holder !== root && PHRASING.test(holder.localName))
        holder = holder.parentElement!;
      if (
        /\S/.test(node.data) &&
        (!bear(parent) ||
          (strict && holder.localName === "div" && (div ??= holder) !== holder))
      )
        return "";
      add(node.data);
    } else if (node instanceof Element) {
      if (node.matches(EDITABLE)) return "";
      if (
        strict &&
        node.matches(STRUCTURE) &&
        !(root.localName === "summary" && node.matches(HEADING)) &&
        (node.localName !== "p" || ++paragraphs > 1)
      )
        return "";
      const name = node.matches(SKIPPED) ? null : imageName(node);
      if (name) {
        if (!bear(node)) return "";
        add(` ${name} `);
      } else if (name === undefined) {
        if (!PHRASING.test(node.localName)) add(" ");
        descend = true;
      }
    }
    if (descend && node.firstChild !== null) node = node.firstChild;
    else {
      while (node !== root && node.nextSibling === null) {
        node = node.parentNode!;
        if (!PHRASING.test((node as Element).localName)) add(" ");
      }
      node = node === root ? null : node.nextSibling;
    }
  }
  return text;
}

/** An option or tree item of an autocomplete or search popup, whose text usually repeats what the user typed. */
function isSuggestion(element: Element) {
  if (
    element.localName !== "option" &&
    !/^(option|treeitem)$/.test(roleOf(element))
  )
    return false;
  if (element.closest("[role~=combobox], datalist") !== null) return true;
  const root = rootOf(element);
  return (
    root !== null &&
    Array.from(
      root.querySelectorAll("[role~=combobox], [aria-autocomplete]"),
    ).some((owner) =>
      [...idRefs(owner, "aria-controls"), ...idRefs(owner, "aria-owns")].some(
        (id) => root.getElementById(id)?.contains(element),
      ),
    )
  );
}

function labelledBy(element: Element) {
  const root = rootOf(element);
  return root === null
    ? null
    : idRefs(element, "aria-labelledby")
        .map((id) => {
          const referenced = root.getElementById(id);
          return referenced === null ? "" : safeText(referenced, false);
        })
        .join(" ");
}

/** A control's own text, unless it is longer than a label: then it is content, not a name. */
const normalize = (text: string) =>
  text.replace(IGNORABLE, "").replace(/\s+/g, " ").trim();

function contentText(element: Element) {
  const text = safeText(element, true);
  return Array.from(normalize(text)).length > MAX_LABEL_LENGTH ? "" : text;
}

/** Removes invisible characters, credentials, emails, URLs, and tokens, then caps the length. */
function cleanLabel(raw: string, redact: Redactor) {
  const chars = Array.from(
    // Scrub again after collapsing, also for remembered values that differ
    // in whitespace or invisible characters.
    redact
      .scrub(
        normalize(redact.body(raw.replace(IGNORABLE, "")) ?? ""),
        normalize,
      )
      .replace(URL_LIKE, "[url]")
      .replace(EMAIL, "[email]")
      .replace(JWT, `$1${REDACTED}`)
      .replace(TOKEN_RUN, (run) => (/\d/.test(run) ? REDACTED : run)),
  );
  return chars.length > MAX_LABEL_LENGTH
    ? `${chars
        .slice(0, MAX_LABEL_LENGTH - 1)
        .join("")
        .trimEnd()}…`
    : chars.join("");
}

function firstLabel(sources: (() => string | null)[], redact: Redactor) {
  for (const source of sources) {
    const label = cleanLabel(source() ?? "", redact);
    if (label) return label;
  }
  return undefined;
}

/**
 * A short name for the clicked control, from the first source that yields one:
 * `aria-labelledby`, `aria-label`, an input caption or `alt`, `title` (controls
 * only), then the text of a control named by its content. Containers, cards,
 * editable content, and autocomplete suggestions never contribute their text.
 * An icon without its own name takes the name of the control around it.
 */
function clickLabel(element: Element, redact: Redactor): string | undefined {
  // aria-labelledby and aria-label apply to any target.
  const named = [
    () => labelledBy(element),
    () => element.getAttribute("aria-label"),
  ];
  if (
    /^(img|svg)$/.test(element.localName) ||
    /^(img|presentation|none)$/.test(roleOf(element))
  ) {
    const own = firstLabel(
      [...named, () => imageName(element) ?? null],
      redact,
    );
    if (own !== undefined) return own;
    // parentElement is null at a shadow root, so the search stays inside it.
    let control = element.parentElement;
    while (control !== null && !isControl(control))
      control = control.parentElement;
    return control === null ? undefined : clickLabel(control, redact);
  }
  const control = isControl(element) && !holdsValue(element);
  const captionInput =
    element instanceof HTMLInputElement && CAPTION_INPUT.test(element.type);
  return firstLabel(
    [
      ...named,
      // The caption of a button-like input, or the `alt` of an image input.
      () =>
        captionInput
          ? element.type === "image"
            ? element.getAttribute("alt")
            : element.value
          : null,
      () => (control || captionInput ? element.getAttribute("title") : null),
      () => (control && !isSuggestion(element) ? contentText(element) : null),
    ],
    redact,
  );
}

/** Snapshot live control properties; HTML attributes do not reflect edited values. */
export function readControlValue(element: Element, redact: Redactor) {
  if (element instanceof HTMLInputElement) {
    return {
      value: redact.isPassword(element) ? REDACTED : element.value,
      ...(["checkbox", "radio"].includes(element.type)
        ? { checked: element.checked }
        : {}),
      ...(element.type === "file"
        ? {
            files: Array.from(element.files ?? [], (file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
              lastModified: file.lastModified,
            })),
          }
        : {}),
    };
  }
  if (element instanceof HTMLSelectElement) {
    return {
      value: element.value,
      selectedValues: Array.from(
        element.selectedOptions,
        (option) => option.value,
      ),
    };
  }
  if (element instanceof HTMLTextAreaElement) return { value: element.value };
  if (element.matches(CONTENTEDITABLE)) {
    return { value: element.textContent ?? "" };
  }
  return {};
}

function eventElement(event: Event) {
  const [first] = event.composedPath();
  return first instanceof Element ? first : null;
}

function isRootOrDetached(el: Element) {
  return el.localName === "body" || el.localName === "html" || !el.isConnected;
}

function isNear(origin: PointerOrigin, event: MouseEvent) {
  return (
    Math.abs(origin.x - event.clientX) <= RECOVERY_DISTANCE_PX &&
    Math.abs(origin.y - event.clientY) <= RECOVERY_DISTANCE_PX
  );
}

/**
 * Listens for clicks in the capture phase on `window`, so handlers that stop
 * propagation do not hide them. The target is described at `pointerdown`,
 * because a re-render before `click` can move the click to `<body>`.
 */
export function installClickCapture(params: {
  emit: Emit;
  getRoute: () => string;
  enrich?: EnrichFn;
  // ponytail: test seam only. jsdom cannot create trusted events; the collector never passes this.
  isTrusted?: (event: Event) => boolean;
  redact?: Redactor;
}) {
  const {
    emit,
    getRoute,
    enrich,
    isTrusted = (event) => event.isTrusted,
    redact = createRedactor(),
  } = params;
  let origin: PointerOrigin | null = null;

  // Input events share describeTarget; only clicks carry a label.
  const describeClick = (el: Element) => {
    const described = describeTarget(el, redact);
    if (described === null) return null;
    try {
      const label = clickLabel(described.element, redact);
      if (label !== undefined) described.target.label = label;
    } catch {
      // A failed label must not drop the click.
    }
    return described;
  };

  const onPointerDown = (event: PointerEvent) => {
    try {
      if (event.isPrimary === false) return;
      const el = eventElement(event);
      origin = {
        described: el === null ? null : describeClick(el),
        x: event.clientX,
        y: event.clientY,
      };
    } catch {
      origin = null;
    }
  };

  const onClick = (event: MouseEvent) => {
    const pointerOrigin = origin;
    origin = null;
    try {
      if (!isTrusted(event)) return;
      const el = eventElement(event);
      if (el === null) return;
      const canRecover =
        pointerOrigin !== null &&
        isRootOrDetached(el) &&
        isNear(pointerOrigin, event);
      const described = canRecover
        ? pointerOrigin.described
        : describeClick(el);
      if (described === null) return;
      const input = event.detail === 0 ? "keyboard" : "pointer";
      emit("click", {
        target: { ...described.target, input },
        route: getRoute(),
        url: redact.url(location.href),
        ...enrich?.(described.element),
      });
    } catch {
      // Capture must never break the host app's click.
    }
  };

  window.addEventListener("pointerdown", onPointerDown, {
    capture: true,
    passive: true,
  });
  window.addEventListener("click", onClick, { capture: true, passive: true });
  return () => {
    window.removeEventListener("pointerdown", onPointerDown, { capture: true });
    window.removeEventListener("click", onClick, { capture: true });
  };
}
