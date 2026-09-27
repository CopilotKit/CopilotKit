import type { ProductInteractionTarget } from "./types";

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
};

function safeMetadata(value: string | null): string | undefined {
  const label = value?.trim();
  // Basic filtering, not anonymization: applications must mark private controls.
  // Include separated phone/card numbers and common credential labels as well.
  if (
    !label ||
    label.length > 80 ||
    sensitiveIdentifier.test(label) ||
    /@|(?:\d[\s()+.-]*){4,}|https?:\/\/|www\.|[\r\n]/i.test(label)
  )
    return;
  return label;
}

function safeIdentifier(value: string | null): string | undefined {
  const label = safeMetadata(value);
  return label && /^[a-z][a-z0-9_.:-]{0,63}$/i.test(label) ? label : undefined;
}

export function describeTarget(
  element: Element,
  includeName: boolean,
): ProductInteractionTarget {
  const tagName = element.tagName.toLowerCase();
  const rawRole = element.getAttribute("role") ?? inferredRoles[tagName];
  const role = rawRole && /^[a-z-]{1,32}$/.test(rawRole) ? rawRole : undefined;
  const result: ProductInteractionTarget = { tagName, ...(role && { role }) };
  const name = safeIdentifier(element.getAttribute("name"));
  const learningId = safeIdentifier(element.getAttribute("data-learning-id"));
  if (name) result.name = name;
  if (learningId) result.learningId = learningId;
  if (includeName) {
    const label = safeMetadata(
      element.getAttribute("aria-label") ?? element.getAttribute("title"),
    );
    if (label) result.accessibleName = label;
  }
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
    return match ? `${match.origin}${match.pathname}` : undefined;
  } catch {
    return;
  }
}
