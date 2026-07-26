import path from "path";
import { CONTENT_DIR, loadDoc, readMeta } from "./docs-render";
import type { FrontendId } from "./frontend-options";

export type FrontendDocPolicy =
  | { kind: "universal" }
  | {
      kind: "frontend-variant";
      fallback: "hide" | "react-proxy" | "coming-soon";
    }
  | { kind: "react-proxy" }
  | { kind: "hide" };

export type FrontendDocResolution =
  | {
      status: "found";
      slugPath: string;
      contentSlugPath: string;
      canonicalPath: string;
      policy: FrontendDocPolicy;
    }
  | { status: "not-found" };

function slugSegments(slugPath: string): string[] | null {
  const segments = slugPath.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return segments;
}

export function parseFrontendDocPolicy(
  value: unknown,
): FrontendDocPolicy | null {
  if (typeof value === "string") {
    if (value === "universal") return { kind: "universal" };
    if (value === "react-proxy") return { kind: "react-proxy" };
    if (value === "hide") return { kind: "hide" };
    if (value === "frontend-variant") {
      return { kind: "frontend-variant", fallback: "hide" };
    }
    return null;
  }

  if (typeof value !== "object" || value === null) return null;

  const policy = value as { kind?: unknown; fallback?: unknown };
  if (policy.kind === "universal") return { kind: "universal" };
  if (policy.kind === "react-proxy") return { kind: "react-proxy" };
  if (policy.kind === "hide") return { kind: "hide" };
  if (policy.kind === "frontend-variant") {
    const fallback =
      policy.fallback === "react-proxy" || policy.fallback === "coming-soon"
        ? policy.fallback
        : "hide";
    return { kind: "frontend-variant", fallback };
  }

  return null;
}

function readDirectoryPolicy(slugPath: string): FrontendDocPolicy | null {
  const segments = slugSegments(slugPath);
  if (!segments) return null;

  for (let length = segments.length; length >= 0; length--) {
    const dir = path.join(CONTENT_DIR, ...segments.slice(0, length));
    const policy = parseFrontendDocPolicy(readMeta(dir)?.frontend);
    if (policy) return policy;
  }

  return null;
}

export function getFrontendDocPolicy(
  slugPath: string,
): FrontendDocPolicy | null {
  const pagePolicy = parseFrontendDocPolicy(loadDoc(slugPath)?.fm.frontend);
  return pagePolicy ?? readDirectoryPolicy(slugPath);
}

export function getFrontendVariantContentSlug(
  frontend: Exclude<FrontendId, "react">,
  slugPath: string,
): string {
  return `frontends/${frontend}/${slugPath}`;
}

export function hasFrontendVariant(
  frontend: Exclude<FrontendId, "react">,
  slugPath: string,
): boolean {
  return loadDoc(getFrontendVariantContentSlug(frontend, slugPath)) !== null;
}

export function isFrontendFirstClassDoc(
  frontend: Exclude<FrontendId, "react">,
  slugPath: string,
): boolean {
  const policy = getFrontendDocPolicy(slugPath);
  if (!policy) return false;
  if (policy.kind === "universal") return true;
  if (policy.kind === "frontend-variant") {
    return hasFrontendVariant(frontend, slugPath);
  }
  return false;
}

export function isFrontendOwnedDoc(slugPath: string): boolean {
  const policy = getFrontendDocPolicy(slugPath);
  return policy?.kind === "universal" || policy?.kind === "frontend-variant";
}

export function resolveFrontendDocPage(
  frontend: Exclude<FrontendId, "react">,
  slugPath: string,
): FrontendDocResolution {
  const variantContentSlug = getFrontendVariantContentSlug(frontend, slugPath);
  const variantDoc = loadDoc(variantContentSlug);
  const policy = getFrontendDocPolicy(slugPath);

  // Angular publishes only its own authored pages. Shared pages can contain
  // APIs and examples for a different frontend, so they must not appear under
  // an Angular URL.
  if (frontend === "angular") {
    return variantDoc
      ? {
          status: "found",
          slugPath,
          contentSlugPath: variantContentSlug,
          canonicalPath: `/${frontend}/${slugPath}`,
          policy: { kind: "frontend-variant", fallback: "hide" },
        }
      : { status: "not-found" };
  }

  if (policy?.kind === "frontend-variant") {
    if (variantDoc) {
      return {
        status: "found",
        slugPath,
        contentSlugPath: variantContentSlug,
        canonicalPath: `/${frontend}/${slugPath}`,
        policy,
      };
    }
    return { status: "not-found" };
  }

  if (policy?.kind === "universal" && loadDoc(slugPath)) {
    return {
      status: "found",
      slugPath,
      contentSlugPath: slugPath,
      canonicalPath: `/${frontend}/${slugPath}`,
      policy,
    };
  }

  if (variantDoc) {
    return {
      status: "found",
      slugPath,
      contentSlugPath: variantContentSlug,
      canonicalPath: `/${frontend}/${slugPath}`,
      policy: { kind: "frontend-variant", fallback: "hide" },
    };
  }

  return { status: "not-found" };
}
