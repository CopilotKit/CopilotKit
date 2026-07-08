// Shared helpers for walking and resolving the `src/content/reference/`
// tree. The v2 reference lives at the root for backwards-compatible
// `/reference/<slug>` URLs and is also exposed as `/reference/v2/<slug>`.
// Every other SDK is nested under its own folder: the v1 React reference
// under `src/content/reference/v1`, the `@copilotkit/core` TypeScript
// reference under `src/content/reference/core`, and so on. Adding a new
// SDK is a matter of appending a version id below + a content folder.

import fs from "fs";
import path from "path";
import React from "react";
import matter from "gray-matter";
import { BookOpen, Slack, MessageCircle } from "lucide-react";
import type * as PageTree from "fumadocs-core/page-tree";
import { CopilotKitMark } from "@/components/copilotkit-mark";
import { resolveWithinDir, safeExistsSync } from "@/lib/safe-fs";

export const REFERENCE_CONTENT_DIR = path.join(
  process.cwd(),
  "src/content/reference",
);

// `v2` is the root SDK (React, latest). Every other id nests under a
// folder of the same name. To add a new SDK: append an id here, add a
// `VERSION_SUBDIRS` entry, add a `VERSION_LABELS` entry in
// `reference-version-selector.tsx` (a `Record<ReferenceVersion, string>`,
// so a missing label is a compile error), and create a
// `src/content/reference/<id>/` folder.
export const REFERENCE_VERSIONS = [
  "v2",
  "v1",
  "react-native",
  "vue",
  "angular",
  "core",
  "channels",
] as const;
export type ReferenceVersion = (typeof REFERENCE_VERSIONS)[number];

/** The root SDK whose content lives directly under `reference/`. */
const ROOT_VERSION: ReferenceVersion = "v2";

export const REFERENCE_CATEGORIES = [
  "Components",
  "Hooks",
  "Functions",
  "Services",
  "Directives",
  "Classes",
  "Types",
  "Enums",
  "SDKs",
  "Slack",
  "Discord",
] as const;
export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];

type ReferenceSubdir =
  | "components"
  | "hooks"
  | "functions"
  | "services"
  | "directives"
  | "classes"
  | "types"
  | "enums"
  | "sdk"
  | "slack"
  | "discord";

const VERSION_SUBDIRS: Record<ReferenceVersion, ReferenceSubdir[]> = {
  v2: ["components", "hooks"],
  v1: ["components", "hooks", "classes", "sdk"],
  "react-native": ["components", "hooks"],
  vue: ["components", "hooks"],
  angular: ["components", "functions", "services", "directives"],
  core: ["classes", "types", "enums"],
  channels: ["components", "functions", "classes", "types", "slack", "discord"],
};

const CATEGORY_BY_SUBDIR: Record<ReferenceSubdir, ReferenceCategory> = {
  components: "Components",
  hooks: "Hooks",
  functions: "Functions",
  services: "Services",
  directives: "Directives",
  classes: "Classes",
  types: "Types",
  enums: "Enums",
  sdk: "SDKs",
  slack: "Slack",
  discord: "Discord",
};

export type ReferenceItem = {
  /** Version-relative slug, e.g. `components/chat` or `hooks/useAgent`. */
  slug: string;
  title: string;
  description?: string;
  category: ReferenceCategory;
  version: ReferenceVersion;
  url: string;
};

export type ResolvedReferencePage = {
  version: ReferenceVersion;
  pageSlug: string;
  contentSlug: string;
  filePath: string;
  raw: string;
};

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

function versionDir(version: ReferenceVersion): string {
  return version === ROOT_VERSION
    ? REFERENCE_CONTENT_DIR
    : path.join(REFERENCE_CONTENT_DIR, version);
}

function versionRelativePrefix(version: ReferenceVersion): string {
  return version === ROOT_VERSION ? "" : `${version}/`;
}

export function referenceHref(
  version: ReferenceVersion,
  pageSlug?: string,
): string {
  const cleanSlug = pageSlug?.replace(/^\/+|\/+$/g, "");
  const suffix = cleanSlug ? `/${cleanSlug}` : "";
  return `/reference/${version}${suffix}`;
}

function contentSlugForPage(
  version: ReferenceVersion,
  pageSlug: string,
): string {
  const prefix = versionRelativePrefix(version);
  return `${prefix}${pageSlug || "index"}`;
}

function pageExists(version: ReferenceVersion, pageSlug: string): boolean {
  const contentSlug = contentSlugForPage(version, pageSlug);
  return (
    safeExistsSync(REFERENCE_CONTENT_DIR, `${contentSlug}.mdx`) ||
    safeExistsSync(REFERENCE_CONTENT_DIR, `${contentSlug}/index.mdx`)
  );
}

export function referenceVersionHref(
  version: ReferenceVersion,
  currentPageSlug?: string,
): string {
  const cleanSlug = currentPageSlug?.replace(/^\/+|\/+$/g, "") ?? "";
  return referenceHref(
    version,
    cleanSlug && pageExists(version, cleanSlug) ? cleanSlug : undefined,
  );
}

/**
 * Recursively collect `.mdx` files under `dir` and return paths relative
 * to `dir` without the `.mdx` extension. Directory index pages are kept
 * as `folder/index` here and normalized later.
 */
function walkMdx(dir: string, prefix: string = ""): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[reference-items] Failed to read dir ${dir}:`, err);
    return [];
  }

  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "meta.json") continue;
    const childAbs = path.join(dir, entry.name);
    const childRel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walkMdx(childAbs, childRel));
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      out.push(childRel.replace(/\.mdx$/, ""));
    }
  }
  return out;
}

function normalizeRouteSlug(subdir: ReferenceSubdir, relSlug: string): string {
  const normalized = relSlug.endsWith("/index")
    ? relSlug.slice(0, -"/index".length)
    : relSlug;
  return normalized === "index" ? subdir : `${subdir}/${normalized}`;
}

function fallbackTitle(routeSlug: string): string {
  return routeSlug.split("/").filter(Boolean).pop() ?? routeSlug;
}

function loadSubdirItems(
  version: ReferenceVersion,
  subdir: ReferenceSubdir,
): ReferenceItem[] {
  const dir = path.join(versionDir(version), subdir);
  if (!fs.existsSync(dir)) return [];

  const items: ReferenceItem[] = [];
  const seenSlugs = new Set<string>();

  for (const relSlug of walkMdx(dir)) {
    const routeSlug = normalizeRouteSlug(subdir, relSlug);
    if (seenSlugs.has(routeSlug)) continue;
    seenSlugs.add(routeSlug);

    const filePath = path.join(dir, `${relSlug}.mdx`);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      console.error(`[reference-items] Failed to read ${filePath}:`, err);
      continue;
    }

    let data: Record<string, unknown> = {};
    try {
      ({ data } = matter(raw));
    } catch (err) {
      console.error(
        `[reference-items] Failed to parse frontmatter in ${filePath}:`,
        err,
      );
      continue;
    }

    items.push({
      slug: routeSlug,
      title:
        typeof data.title === "string" && data.title.length > 0
          ? data.title
          : fallbackTitle(routeSlug),
      description:
        typeof data.description === "string" ? data.description : undefined,
      category: CATEGORY_BY_SUBDIR[subdir],
      version,
      url: referenceHref(version, routeSlug),
    });
  }

  return items;
}

const itemsCache = new Map<string, ReferenceItem[]>();

export function loadReferenceItems(
  version: ReferenceVersion,
  subdir: ReferenceSubdir,
): ReferenceItem[] {
  const cacheKey = `${version}:${subdir}`;
  if (isProd()) {
    const cached = itemsCache.get(cacheKey);
    if (cached) return cached;
  }

  const items = loadSubdirItems(version, subdir);
  if (isProd()) itemsCache.set(cacheKey, items);
  return items;
}

export function loadReferenceVersionItems(
  version: ReferenceVersion,
): ReferenceItem[] {
  return VERSION_SUBDIRS[version].flatMap((subdir) =>
    loadReferenceItems(version, subdir),
  );
}

function itemToPage(item: ReferenceItem): PageTree.Item {
  return { type: "page", name: item.title, url: item.url };
}

function withInlineIcon(icon: React.ReactNode, label: string): React.ReactNode {
  return React.createElement(
    React.Fragment,
    null,
    React.isValidElement(icon)
      ? React.cloneElement(icon, { key: "icon" })
      : icon,
    React.createElement("span", { key: "label" }, label),
  );
}

function referenceRootName(): React.ReactNode {
  return withInlineIcon(
    React.createElement(BookOpen, { size: 16 }),
    "Reference",
  );
}

// Package separators carry the package's mark. Merge icon + label into
// the separator's `name` (fumadocs renders `[item.icon, item.name]` as
// a keyless child array, so the split `icon` prop triggers React's key
// warning).
function packageSeparator(
  icon: React.ReactNode,
  label: string,
): PageTree.Separator {
  return {
    type: "separator",
    name: withInlineIcon(icon, label),
  };
}

/**
 * The Channels tab groups the sidebar by package, not by category: a
 * `@copilotkit/channels` section with collapsed kind-folders (Components /
 * Functions / Classes / Types), then a flat `@copilotkit/channels-slack`
 * section listing the adapter's own exports (the `slack/` subdir).
 */
function buildChannelsPageTree(): PageTree.Root {
  const kindFolder = (
    name: string,
    subdir: ReferenceSubdir,
  ): PageTree.Folder[] => {
    const items = loadReferenceItems("channels", subdir);
    if (items.length === 0) return [];
    return [
      {
        type: "folder",
        name,
        defaultOpen: false,
        children: items.map(itemToPage),
      },
    ];
  };

  // Explicit order: the adapter factory first, then rendering, then the
  // supporting exports. Anything new lands after, in filesystem order.
  const SLACK_ORDER = [
    "slack",
    "slack/renderBlockKit",
    "slack/markdownToMrkdwn",
    "slack/defaultSlackTools",
    "slack/defaultSlackContext",
    "slack/SanitizingHttpAgent",
  ];
  const slackItems = [...loadReferenceItems("channels", "slack")].sort(
    (a, b) => {
      const ai = SLACK_ORDER.indexOf(a.slug);
      const bi = SLACK_ORDER.indexOf(b.slug);
      return (
        (ai === -1 ? SLACK_ORDER.length : ai) -
        (bi === -1 ? SLACK_ORDER.length : bi)
      );
    },
  );

  const slackCoreFolder: PageTree.Folder[] =
    slackItems.length === 0
      ? []
      : [
          {
            type: "folder",
            name: "Core",
            defaultOpen: false,
            children: slackItems.map(itemToPage),
          },
        ];

  // Explicit order: adapter factory first, then rendering, then supporting
  // exports. Anything new lands after, in filesystem order.
  const DISCORD_ORDER = [
    "discord",
    "discord/renderComponents",
    "discord/defaultDiscordTools",
    "discord/defaultDiscordContext",
    "discord/DISCORD_LIMITS",
  ];
  const discordItems = [...loadReferenceItems("channels", "discord")].sort(
    (a, b) => {
      const ai = DISCORD_ORDER.indexOf(a.slug);
      const bi = DISCORD_ORDER.indexOf(b.slug);
      return (
        (ai === -1 ? DISCORD_ORDER.length : ai) -
        (bi === -1 ? DISCORD_ORDER.length : bi)
      );
    },
  );

  const discordCoreFolder: PageTree.Folder[] =
    discordItems.length === 0
      ? []
      : [
          {
            type: "folder",
            name: "Core",
            defaultOpen: false,
            children: discordItems.map(itemToPage),
          },
        ];

  return {
    name: referenceRootName(),
    children: [
      packageSeparator(
        React.createElement(CopilotKitMark),
        "@copilotkit/channels",
      ),
      ...kindFolder("Components", "components"),
      ...kindFolder("Functions", "functions"),
      ...kindFolder("Classes", "classes"),
      ...kindFolder("Types", "types"),
      packageSeparator(
        React.createElement(Slack, { size: 16 }),
        "@copilotkit/channels-slack",
      ),
      ...slackCoreFolder,
      packageSeparator(
        React.createElement(MessageCircle, { size: 16 }),
        "@copilotkit/channels-discord",
      ),
      ...discordCoreFolder,
    ],
  };
}

export function buildReferencePageTree(
  version: ReferenceVersion,
): PageTree.Root {
  if (version === "channels") return buildChannelsPageTree();
  const allItems = loadReferenceVersionItems(version);
  return {
    name: referenceRootName(),
    children: REFERENCE_CATEGORIES.flatMap((category) => {
      const categoryItems = allItems.filter(
        (item) => item.category === category,
      );
      if (categoryItems.length === 0) return [];
      return [
        { type: "separator" as const, name: category },
        ...categoryItems.map(itemToPage),
      ];
    }),
  };
}

function splitVersionedSlug(slugPath: string): {
  version: ReferenceVersion;
  pageSlug: string;
} {
  for (const version of REFERENCE_VERSIONS) {
    if (slugPath === version || slugPath.startsWith(`${version}/`)) {
      // Strip the version id by length (slice), not a RegExp built from the
      // id, so a future id with a regex-special char can't corrupt the match.
      // The trailing `replace(/^\//, "")` is a fixed pattern just trimming the
      // separator, so it's safe.
      return {
        version,
        pageSlug: slugPath.slice(version.length).replace(/^\//, ""),
      };
    }
  }
  // Unprefixed slugs (`/reference/<slug>`) resolve against the root SDK.
  return { version: ROOT_VERSION, pageSlug: slugPath };
}

export function resolveReferencePage(
  slug: string[],
): ResolvedReferencePage | null {
  const slugPath = slug.join("/");
  const { version, pageSlug } = splitVersionedSlug(slugPath);
  const contentSlug = contentSlugForPage(version, pageSlug);
  const filePath = [`${contentSlug}.mdx`, `${contentSlug}/index.mdx`]
    .map((candidate) => resolveWithinDir(REFERENCE_CONTENT_DIR, candidate))
    .find((candidate) => candidate !== null && fs.existsSync(candidate));

  if (!filePath) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(`[reference-items] Failed to read ${filePath}:`, err);
    return null;
  }

  return {
    version,
    pageSlug,
    contentSlug,
    filePath,
    raw,
  };
}

export function referenceStaticParams(): { slug: string[] }[] {
  const params = new Map<string, string[]>();
  const add = (slug: string[]) => params.set(slug.join("/"), slug);

  for (const version of REFERENCE_VERSIONS) {
    add([version]);
    for (const item of loadReferenceVersionItems(version)) {
      add([version, ...item.slug.split("/")]);
      if (version === ROOT_VERSION) {
        add(item.slug.split("/"));
      }
    }
  }

  return [...params.values()].map((slug) => ({ slug }));
}
