export type FrontendId =
  | "react"
  | "vue"
  | "react-native"
  | "angular"
  | "slack"
  | "teams";

export type FrontendIcon = FrontendId;

export interface FrontendOption {
  id: FrontendId;
  name: string;
  icon: FrontendIcon;
  summary: string;
}

export const FRONTEND_OPTIONS: readonly FrontendOption[] = [
  {
    id: "react",
    name: "React",
    icon: "react",
    summary: "The complete CopilotKit docs experience.",
  },
  {
    id: "vue",
    name: "Vue",
    icon: "vue",
    summary: "Vue 3 provider, composables, and chat primitives.",
  },
  {
    id: "react-native",
    name: "React Native",
    icon: "react-native",
    summary: "Mobile bindings for React Native and Expo apps.",
  },
  {
    id: "angular",
    name: "Angular",
    icon: "angular",
    summary: "Angular components, directives, and services.",
  },
  {
    id: "slack",
    name: "Slack",
    icon: "slack",
    summary: "Slack bot quickstart with streaming agent replies.",
  },
  {
    id: "teams",
    name: "Teams",
    icon: "teams",
    summary: "Microsoft Teams bot quickstart with the M365 Agents Playground.",
  },
] as const;

const FRONTEND_IDS = new Set<string>(
  FRONTEND_OPTIONS.map((option) => option.id),
);

export function isFrontendId(value: string | undefined): value is FrontendId {
  return value !== undefined && FRONTEND_IDS.has(value);
}

export function getFrontendOption(id: FrontendId): FrontendOption {
  return FRONTEND_OPTIONS.find((option) => option.id === id)!;
}

export function isFrontendEarlyAccess(id: FrontendId): boolean {
  return id === "slack" || id === "teams";
}

function normalizeSlugPath(slugPath: string): string {
  return slugPath.split("/").filter(Boolean).join("/");
}

export function frontendPathFor(id: FrontendId, slugPath = ""): string {
  const normalizedSlugPath = normalizeSlugPath(slugPath);
  return frontendPathForBackend(id, normalizedSlugPath, null);
}

export function frontendPathForBackend(
  id: FrontendId,
  slugPath = "",
  backendFrameworkSlug: string | null = null,
): string {
  const normalizedSlugPath = normalizeSlugPath(slugPath);
  const basePath =
    id === "react"
      ? backendFrameworkSlug
        ? `/${backendFrameworkSlug}`
        : ""
      : backendFrameworkSlug
        ? `/${id}/${backendFrameworkSlug}`
        : `/${id}`;

  if (
    normalizedSlugPath === "" ||
    normalizedSlugPath === "quickstart" ||
    (id === "react" && normalizedSlugPath === "using-these-docs")
  ) {
    return basePath || "/";
  }

  return basePath
    ? `${basePath}/${normalizedSlugPath}`
    : `/${normalizedSlugPath}`;
}

export function frontendFromPathname(
  pathname: string,
): Exclude<FrontendId, "react"> | null {
  const [first] = pathname.split("/").filter(Boolean);
  if (!isFrontendId(first) || first === "react") return null;
  return first;
}

export interface FrontendRoutePath {
  frontend: Exclude<FrontendId, "react">;
  backend: string | null;
  slugPath: string;
}

function pathnameSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

export function parseFrontendRoutePath(
  pathname: string,
  backendFrameworkSlugs: readonly string[] = [],
): FrontendRoutePath | null {
  const [first, ...rest] = pathnameSegments(pathname);
  if (!isFrontendId(first) || first === "react") return null;

  const [maybeBackend, ...tail] = rest;
  const backend =
    maybeBackend && backendFrameworkSlugs.includes(maybeBackend)
      ? maybeBackend
      : null;

  return {
    frontend: first,
    backend,
    slugPath: backend ? tail.join("/") : rest.join("/"),
  };
}

export function backendFromPathname(
  pathname: string,
  backendFrameworkSlugs: readonly string[] = [],
): string | null {
  const frontendRoute = parseFrontendRoutePath(pathname, backendFrameworkSlugs);
  if (frontendRoute) return frontendRoute.backend;

  const [first] = pathnameSegments(pathname);
  return first && backendFrameworkSlugs.includes(first) ? first : null;
}

export function frontendPathForCurrentPath(
  id: FrontendId,
  pathname: string,
  backendFrameworkSlugs: readonly string[] = [],
): string {
  const frontendRoute = parseFrontendRoutePath(pathname, backendFrameworkSlugs);
  if (frontendRoute) {
    return frontendPathForBackend(
      id,
      frontendRoute.slugPath,
      frontendRoute.backend,
    );
  }

  const [first = "", ...rest] = pathnameSegments(pathname);
  if (backendFrameworkSlugs.includes(first)) {
    return frontendPathForBackend(id, rest.join("/"), first);
  }

  return frontendPathFor(id, [first, ...rest].join("/"));
}

export function backendPathForCurrentPath(
  slug: string,
  pathname: string,
  backendFrameworkSlugs: readonly string[] = [],
  defaultFrameworkSlug: string,
): string {
  const backend = slug === defaultFrameworkSlug ? null : slug;
  const frontendRoute = parseFrontendRoutePath(pathname, backendFrameworkSlugs);
  if (frontendRoute) {
    return frontendPathForBackend(
      frontendRoute.frontend,
      frontendRoute.slugPath,
      backend,
    );
  }

  const [first = "", ...rest] = pathnameSegments(pathname);
  if (backendFrameworkSlugs.includes(first)) {
    return frontendPathForBackend("react", rest.join("/"), backend);
  }

  return frontendPathForBackend("react", [first, ...rest].join("/"), backend);
}
