import { FRAMEWORKS } from "./data";

export const VARIANT_IDS = ["a", "b", "c", "d"] as const;
export type VariantId = (typeof VARIANT_IDS)[number];

export function isVariant(v: string): v is VariantId {
  return (VARIANT_IDS as readonly string[]).includes(v);
}

/** Prototype D is the site itself, at the root; the others stay under /proto. */
export function variantBase(variant: VariantId) {
  return variant === "d" ? "" : `/proto/${variant}`;
}

/** Combo C nests frameworks under /integrations; A and B put them at the top. */
export function nestsUnderIntegrations(variant: VariantId) {
  return variant === "c";
}

export function frameworkHref(
  variant: VariantId,
  framework: string,
  slug?: string,
) {
  const base = nestsUnderIntegrations(variant)
    ? `${variantBase(variant)}/integrations/${framework}`
    : `${variantBase(variant)}/${framework}`;
  return slug ? `${base}/${slug}` : base;
}

export function sectionHref(
  variant: VariantId,
  section: "docs" | "intelligence" | "integrations",
  slug?: string,
) {
  // D's docs home is the site's home page.
  if (variant === "d" && section === "docs" && !slug) return "/";
  return `${variantBase(variant)}/${section}${slug ? `/${slug}` : ""}`;
}

export type Location =
  | { kind: "docs"; slug: string }
  | { kind: "examples" }
  | { kind: "intelligence"; slug: string }
  | { kind: "integrations" }
  | { kind: "framework"; framework: string; slug: string };

const FRAMEWORK_IDS = new Set(FRAMEWORKS.map((f) => f.id));

export function parseLocation(
  variant: VariantId,
  path: string[],
): Location | null {
  const [first = "docs", ...rest] = path;
  if (first === "docs") return { kind: "docs", slug: rest.join("/") };
  if (first === "examples" && variant === "d") return { kind: "examples" };
  if (first === "intelligence")
    return { kind: "intelligence", slug: rest.join("/") };
  if (nestsUnderIntegrations(variant)) {
    if (first !== "integrations") return null;
    const [fw, ...slug] = rest;
    if (!fw) return { kind: "integrations" };
    return FRAMEWORK_IDS.has(fw)
      ? { kind: "framework", framework: fw, slug: slug.join("/") }
      : null;
  }
  if (first === "integrations") return { kind: "integrations" };
  return FRAMEWORK_IDS.has(first)
    ? { kind: "framework", framework: first, slug: rest.join("/") }
    : null;
}

export function locationFromPathname(pathname: string): {
  variant: VariantId;
  location: Location | null;
} {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "proto" && parts[1] && isVariant(parts[1])) {
    return {
      variant: parts[1],
      location: parseLocation(parts[1], parts.slice(2)),
    };
  }
  return { variant: "d", location: parseLocation("d", parts) };
}
