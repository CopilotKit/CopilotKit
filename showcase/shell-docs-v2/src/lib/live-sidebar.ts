import type * as PageTree from "fumadocs-core/page-tree";

/**
 * shell-docs' sidebar pipeline (`src/lib/docs-render.tsx`), ported so the live
 * docs keep production's sidebar: the meta.json trees are regrouped into the
 * same fixed sections (Basics, Generative UI, Interactivity, ...) with topic
 * folders. Pure data, so the docs layout runs it on the client per URL.
 *
 * Slugs are relative to the surface (`frontend-tools`, `intelligence/overview`)
 * and become URLs in `src/proto/live-tree.tsx`.
 */
export type NavNode =
  | {
      type: "page";
      title: string;
      slug: string;
      href?: string;
      icon?: string;
    }
  | { type: "section"; title: string }
  | {
      type: "group";
      title: string;
      slug: string;
      children: NavNode[];
      defaultOpen?: boolean;
    };
type Group = Extract<NavNode, { type: "group" }>;

/* ---------- from Fumadocs' page tree ---------- */

/** A page tree as NavNodes, with `base` (`/integrations/mastra`) cut from URLs. */
export function toNav(nodes: PageTree.Node[], base = ""): NavNode[] {
  const slugOf = (url: string) =>
    url.slice(base.length).replace(/^\/+|\/+$/g, "");
  const convert = (n: PageTree.Node): NavNode => {
    const title = typeof n.name === "string" ? n.name : "";
    if (n.type === "separator") return { type: "section", title };
    if (n.type === "page") return { type: "page", title, slug: slugOf(n.url) };
    const children = [
      ...(n.index ? [convert(n.index)] : []),
      ...n.children.map(convert),
    ];
    return {
      type: "group",
      title,
      slug: n.index ? slugOf(n.index.url) : commonDir(children),
      children,
      defaultOpen: n.defaultOpen,
    };
  };
  return nodes.map(convert);
}

function commonDir(nodes: NavNode[]): string {
  const slugs = nodes.flatMap((n) => (n.type === "section" ? [] : [n.slug]));
  const first = slugs[0]?.split("/").slice(0, -1) ?? [];
  let depth = first.length;
  for (const s of slugs) {
    const parts = s.split("/");
    while (
      depth &&
      parts.slice(0, depth).join("/") !== first.slice(0, depth).join("/")
    )
      depth--;
  }
  return first.slice(0, depth).join("/");
}

/* ---------- surface trees ---------- */

/** Root sections a framework's own sidebar takes (`SHARED_ROOT_SECTIONS`). */
const FRAMEWORK_SHARED = ["Intelligence", "Platforms"];
/** Root sections the root surface adds to the built-in agent's (`ROOT_SURFACE_SECTIONS`). */
const ROOT_SURFACE_SHARED = [
  "Concepts",
  "Runtime",
  "Intelligence",
  "Deploy",
  "Platforms",
  "Other",
];

/** `buildFrameworkOnlyNav` / `buildRootSurfaceNav`: a framework that authors its docs. */
export function authoredSidebar(
  own: NavNode[],
  root: NavNode[],
  rootSurface: boolean,
): NavNode[] {
  return normalizeSidebarNav(
    dropEmptySections(
      appendSharedThreadPages(
        appendSharedRootSections(
          own,
          root,
          rootSurface ? ROOT_SURFACE_SHARED : FRAMEWORK_SHARED,
        ),
        root,
      ),
    ),
    root,
  );
}

/** `buildFrameworkNav`: generated docs, the root tree plus the framework's overrides. */
export function generatedSidebar(
  overrides: NavNode[],
  root: NavNode[],
  frameworkName: string,
): NavNode[] {
  return normalizeSidebarNav(
    mergeFrameworkNav(root, overrides, frameworkName),
    root,
  );
}

/* ---------- helpers ---------- */

function dropEmptySections(nav: NavNode[]): NavNode[] {
  return nav.filter((node, i) => {
    if (node.type !== "section") return true;
    const next = nav[i + 1];
    return next !== undefined && next.type !== "section";
  });
}

function sectionRange(nav: NavNode[], title: string) {
  const start = nav.findIndex(
    (n) =>
      n.type === "section" && n.title.toLowerCase() === title.toLowerCase(),
  );
  if (start === -1) return null;
  const next = nav.findIndex((n, i) => i > start && n.type === "section");
  return { start, end: next === -1 ? nav.length : next };
}

function hasPageSlug(nav: NavNode[], slug: string): boolean {
  return nav.some((n) =>
    n.type === "page"
      ? n.slug === slug
      : n.type === "group" && hasPageSlug(n.children, slug),
  );
}

function findPageBySlug(nav: NavNode[], slug: string): NavNode | null {
  for (const n of nav) {
    if (n.type === "page" && n.slug === slug) return n;
    if (n.type === "group") {
      const hit = findPageBySlug(n.children, slug);
      if (hit) return hit;
    }
  }
  return null;
}

function findNavNode(
  nav: NavNode[],
  predicate: (n: NavNode) => boolean,
): NavNode | null {
  for (const n of nav) {
    if (predicate(n)) return n;
    if (n.type === "group") {
      const hit = findNavNode(n.children, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

const isRouteGroupSegment = (s: string) => s.startsWith("(") && s.endsWith(")");

function isRouteGroupNode(n: NavNode): boolean {
  return n.type !== "section" && n.slug.split("/").some(isRouteGroupSegment);
}

function filterMissingPages(n: NavNode, nav: NavNode[]): NavNode | null {
  if (n.type === "page") return hasPageSlug(nav, n.slug) ? null : n;
  if (n.type === "group") {
    const children = n.children
      .map((c) => filterMissingPages(c, nav))
      .filter((c): c is NavNode => c !== null);
    return children.length ? { ...n, children } : null;
  }
  return n;
}

function appendSharedRootSections(
  nav: NavNode[],
  root: NavNode[],
  titles: string[],
): NavNode[] {
  let out = nav;
  for (const title of titles) {
    const from = sectionRange(root, title);
    if (!from) continue;
    const missing = root
      .slice(from.start + 1, from.end)
      .filter((n) => !isRouteGroupNode(n))
      .map((n) => filterMissingPages(n, out))
      .filter((n): n is NavNode => n !== null);
    if (!missing.length) continue;
    const at = sectionRange(out, title);
    out = at
      ? [...out.slice(0, at.end), ...missing, ...out.slice(at.end)]
      : [...out, root[from.start], ...missing];
  }
  return out;
}

function isRichThreadsGroup(n: NavNode): n is Group {
  return (
    n.type === "group" &&
    n.title === "AG-UI Streams" &&
    hasPageSlug(n.children, "AG-UI-Streams")
  );
}

function appendSharedThreadPages(nav: NavNode[], root: NavNode[]): NavNode[] {
  const rootGroup = root.find(isRichThreadsGroup);
  if (!rootGroup) return nav;
  const shared = [
    "intelligence/bring-your-own-thread-system",
    "intelligence/threads-explained",
  ].flatMap((slug) => {
    const page = findPageBySlug(rootGroup.children, slug);
    return page ? [page] : [];
  });
  return nav.map((n) =>
    isRichThreadsGroup(n)
      ? {
          ...n,
          children: [
            ...n.children,
            ...shared.filter(
              (p) => p.type === "page" && !hasPageSlug(n.children, p.slug),
            ),
          ],
        }
      : n,
  );
}

function mergeFrameworkNav(
  root: NavNode[],
  overrides: NavNode[],
  frameworkName: string,
): NavNode[] {
  if (!overrides.length) return root;
  const introIdx = overrides.findIndex(
    (n) => n.type === "page" && n.slug === "",
  );
  const intro = introIdx >= 0 ? overrides[introIdx] : null;
  const rest =
    introIdx >= 0
      ? [...overrides.slice(0, introIdx), ...overrides.slice(introIdx + 1)]
      : overrides;
  const header: NavNode = { type: "section", title: frameworkName };
  const isSection = (n: NavNode, title: string) =>
    n.type === "section" && n.title.toLowerCase() === title.toLowerCase();
  let insertAt = -1;
  for (const anchor of [
    "add agent powers",
    "give your app agent powers",
    "app control",
    "agents & backends",
    "backend",
    "runtime",
  ]) {
    const anchorIdx = root.findIndex((n) => isSection(n, anchor));
    if (anchorIdx === -1) continue;
    for (let i = anchorIdx + 1; i < root.length; i++) {
      if (root[i].type === "section") {
        insertAt = i;
        break;
      }
    }
    if (insertAt !== -1) break;
  }
  const rootHasIntro = root.some((n) => n.type === "page" && n.slug === "");
  const getStartedIdx = root.findIndex((n) => isSection(n, "get started"));
  const rootWithIntro = !intro
    ? root
    : rootHasIntro
      ? root.map((n) => (n.type === "page" && n.slug === "" ? intro : n))
      : getStartedIdx === -1
        ? [intro, ...root]
        : [
            ...root.slice(0, getStartedIdx + 1),
            intro,
            ...root.slice(getStartedIdx + 1),
          ];
  if (insertAt === -1) return [...rootWithIntro, header, ...rest];
  const shifted =
    !!intro &&
    !rootHasIntro &&
    (getStartedIdx === -1 || insertAt > getStartedIdx);
  const at = shifted ? insertAt + 1 : insertAt;
  return [
    ...rootWithIntro.slice(0, at),
    header,
    ...rest,
    ...rootWithIntro.slice(at),
  ];
}

/* ---------- normalizeSidebarNav ---------- */

type Section = {
  section: Extract<NavNode, { type: "section" }>;
  children: NavNode[];
};
type Buckets = { prefix: NavNode[]; sections: Section[] };

const SIDEBAR_SECTION_TITLES: Record<string, string> = {
  "get started": "Getting Started",
  "getting started": "Getting Started",
  "build chat uis": "Basics",
  basics: "Basics",
  "build generative ui": "Generative UI",
  "generative ui": "Generative UI",
  "add agent powers": "App Control",
  "app control": "App Control",
  intelligence: "Intelligence",
  "intelligence platform": "Intelligence",
  backend: "Runtime",
  runtime: "Runtime",
  deploy: "Deployment",
  deployment: "Deployment",
};

const RESERVED_SIDEBAR_SECTIONS = new Set([
  "Getting Started",
  "Basics",
  "Generative UI",
  "App Control",
  "Interactivity",
  "Agent capabilities",
  "Runtime",
  "Intelligence",
  "Backend",
  "Deployment",
  "Concepts",
  "Learn",
  "Observe & Operate",
  "Platforms",
  "Troubleshooting",
  "Other",
]);

function splitSidebarSections(nav: NavNode[]): Buckets {
  const prefix: NavNode[] = [];
  const sections: Section[] = [];
  const byTitle = new Map<string, Section>();
  let current: Section | undefined;
  for (const node of nav) {
    if (node.type !== "section") {
      if (current) current.children.push(node);
      else prefix.push(node);
      continue;
    }
    const title =
      SIDEBAR_SECTION_TITLES[node.title.toLowerCase()] ?? node.title;
    const existing = byTitle.get(title);
    if (existing) {
      current = existing;
      continue;
    }
    current = { section: { ...node, title }, children: [] };
    sections.push(current);
    byTitle.set(title, current);
  }
  return { prefix, sections };
}

const sectionChildren = (b: Buckets, title: string) =>
  b.sections.find(({ section }) => section.title === title)?.children ?? [];

const flattenUntitledGroups = (nodes: NavNode[]) =>
  nodes.flatMap((n) =>
    n.type === "group" && n.title === "" ? n.children : [n],
  );

function topicGroup(
  title: string,
  slug: string,
  source: NavNode | NavNode[] | null,
  defaultOpen = false,
): Group | null {
  if (!source) return null;
  const children = Array.isArray(source)
    ? source
    : source.type === "group"
      ? source.children
      : [source];
  return children.length
    ? { type: "group", title, slug, children, defaultOpen }
    : null;
}

const withoutRouteGroupSlug = (slug: string) =>
  slug
    .split("/")
    .filter((s) => !isRouteGroupSegment(s))
    .join("/");

function withoutRouteGroupSegments(n: NavNode): NavNode {
  if (n.type === "section") return n;
  const slug = withoutRouteGroupSlug(n.slug);
  return n.type === "page"
    ? { ...n, slug }
    : { ...n, slug, children: n.children.map(withoutRouteGroupSegments) };
}

function uniqueSidebarNodes(nodes: NavNode[]): NavNode[] {
  const seen = new Set<string>();
  return nodes.filter((n) => {
    const key =
      n.type === "section"
        ? `section:${n.title}`
        : n.type === "page"
          ? `page:${n.href ?? n.slug}`
          : `group:${n.title}:${n.slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sidebarSection(title: string, children: Array<NavNode | null>) {
  const present = children.filter((n): n is NavNode => n !== null);
  return [{ type: "section", title } satisfies NavNode, ...present];
}

function isSharedFrameworkNode(n: NavNode): boolean {
  if (n.type === "section") return true;
  const slug = withoutRouteGroupSlug(n.slug);
  return (
    [
      "frontend-tools",
      "webmcp",
      "learning",
      "inspector",
      "vs-code-extension",
      "telemetry",
      "multi-agent/subagents",
      "shared-state",
      "human-in-the-loop",
    ].includes(slug) ||
    slug.startsWith("shared-state/") ||
    slug.startsWith("human-in-the-loop/")
  );
}

const notNull = <T>(n: T | null): n is T => n !== null;

/**
 * Every surface's tree reduced to the same sidebar map: a few always-visible
 * rows, then fixed sections whose detail pages sit inside topic folders.
 * shell-docs' `normalizeSidebarNav`, minus its "Introduction" row (framework
 * roots open their quickstart).
 */
function normalizeSidebarNav(nav: NavNode[], root: NavNode[]): NavNode[] {
  const input = splitSidebarSections(nav);
  const canonical = splitSidebarSections(root);
  const allInput = [
    ...input.prefix,
    ...input.sections.flatMap(({ children }) => children),
  ];
  const allCanonical = [
    ...canonical.prefix,
    ...canonical.sections.flatMap(({ children }) => children),
  ];
  const findPage = (slug: string) =>
    findPageBySlug(allInput, slug) ?? findPageBySlug(allCanonical, slug);
  const findGroup = (nodes: NavNode[], title: string) =>
    findNavNode(
      nodes,
      (n) =>
        n.type === "group" && n.title.toLowerCase() === title.toLowerCase(),
    );
  const asPage = (n: NavNode | null, title: string, icon?: string) =>
    n?.type === "page" ? { ...n, title, icon } : null;

  const gettingStarted = [
    ...input.prefix,
    ...sectionChildren(input, "Getting Started"),
  ];
  const introduction = findPageBySlug(gettingStarted, "");
  const quickstart =
    findPageBySlug(gettingStarted, "quickstart") ?? findPage("quickstart");
  const startLinks = [
    asPage(quickstart, "Quickstart", "play"),
    asPage(
      findPageBySlug(gettingStarted, "build-with-agents") ??
        findPage("build-with-agents"),
      "Build with agents",
      "brain",
    ),
    asPage(findPage("intelligence/overview"), "Intelligence", "kite"),
  ].filter(notNull);
  const frontendGettingStartedExtras = gettingStarted.filter(
    (n) =>
      n.type === "page" &&
      n !== introduction &&
      n !== quickstart &&
      (n.slug === "using-these-docs" ||
        n.slug === "features" ||
        n.title.toLowerCase().includes("angular")),
  );

  // Basics
  const inputBasics = sectionChildren(input, "Basics");
  const canonicalBasics = sectionChildren(canonical, "Basics");
  const existingChat = findGroup(inputBasics, "Chat");
  const authoredThreads =
    findGroup(inputBasics, "Threads") ?? findGroup(canonicalBasics, "Threads");
  const threadUi =
    authoredThreads?.type === "group" ? authoredThreads.children : [];
  const threadDelivery = [
    "AG-UI-Streams",
    "intelligence/bring-your-own-thread-system",
    "threads-import",
    "threads-lifecycle",
    "intelligence/threads-explained",
  ];
  const filterChat = (nodes: NavNode[]) =>
    nodes.filter(
      (n) =>
        !(
          n.type === "group" && ["Threads", "AG-UI Streams"].includes(n.title)
        ) &&
        !(
          n.type === "page" &&
          (["inspector", ...threadDelivery].includes(n.slug) ||
            Boolean(findPageBySlug(threadUi, n.slug)))
        ),
    );
  const inputChat = filterChat(inputBasics);
  const chatSource =
    existingChat?.type === "group"
      ? filterChat(existingChat.children)
      : inputChat.length
        ? inputChat
        : filterChat(canonicalBasics);

  // Generative UI
  const inputGenerative = flattenUntitledGroups(
    sectionChildren(input, "Generative UI"),
  );
  const canonicalGenerative = flattenUntitledGroups(
    sectionChildren(canonical, "Generative UI"),
  );
  const generativeTopic = (title: string, display = title) =>
    topicGroup(
      display,
      `sidebar#generative-${display.toLowerCase().replaceAll(" ", "-")}`,
      findGroup(inputGenerative, title) ??
        findGroup(canonicalGenerative, title),
    );

  // Interactivity
  const interactivitySources = [
    ...sectionChildren(input, "Interactivity"),
    ...sectionChildren(input, "App Control"),
    ...sectionChildren(canonical, "App Control"),
  ];
  const sharedState =
    findGroup(interactivitySources, "Shared state") ?? findPage("shared-state");
  const humanInTheLoop =
    findGroup(interactivitySources, "Human-in-the-loop") ??
    findGroup(interactivitySources, "Human in the loop") ??
    findNavNode(
      interactivitySources,
      (n) => n.type === "group" && n.slug === "human-in-the-loop",
    );

  // Agent capabilities: the framework's own pages.
  const existingFrameworkGroups = sectionChildren(
    input,
    "Agent capabilities",
  ).filter(
    (n) =>
      n.type === "group" &&
      !["automatic learning", "sub-agents"].includes(n.title.toLowerCase()),
  );
  const frameworkGroups = existingFrameworkGroups.length
    ? existingFrameworkGroups
    : input.sections
        .filter(
          ({ section, children }) =>
            !RESERVED_SIDEBAR_SECTIONS.has(section.title) &&
            children.some((n) => !isSharedFrameworkNode(n)),
        )
        .map(({ section, children }) =>
          topicGroup(
            section.title,
            `sidebar#framework-${section.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
            children.filter((n) => !isSharedFrameworkNode(n)),
          ),
        )
        .filter(notNull);

  // Intelligence
  const intel = (slug: string, title: string) => asPage(findPage(slug), title);
  const intelligence = sidebarSection("Intelligence", [
    intel("intelligence/overview", "Overview"),
    topicGroup(
      "Get started",
      "sidebar#intelligence-get-started",
      [
        intel("intelligence/quickstart", "Quickstart"),
        intel("intelligence/intelligence-platform", "Architecture"),
        intel("intelligence/plans", "Plans"),
      ].filter(notNull),
    ),
    topicGroup(
      "Features",
      "sidebar#intelligence-features",
      [
        topicGroup(
          "AG-UI Streams",
          "sidebar#ag-ui-streams",
          [
            intel("AG-UI-Streams", "Overview"),
            intel(
              "intelligence/bring-your-own-thread-system",
              "Bring your own thread system",
            ),
            intel("threads-import", "Add to Existing Threads"),
            intel("threads-lifecycle", "Thread & History Lifecycle"),
            intel(
              "intelligence/threads-explained",
              "Streams & Framework Threads",
            ),
          ].filter(notNull),
        ),
        topicGroup(
          "Automatic Learning",
          "learning",
          [
            intel("learning", "Automatic Learning"),
            intel("intelligence/learned-skills", "Skill delivery"),
          ].filter(notNull),
        ),
        intel("intelligence/memories", "User Memories"),
        topicGroup(
          "Trajectories",
          "intelligence/trajectories",
          [
            intel("intelligence/trajectories", "Overview"),
            intel("intelligence/trajectories-quickstart", "Quickstart"),
            intel("intelligence/capture-interactions", "Capture interactions"),
            intel("intelligence/captured-data", "Captured data"),
            intel("intelligence/trajectories-reference", "API reference"),
          ].filter(notNull),
        ),
        intel("intelligence/standalone-collector", "Standalone collector"),
        intel("intelligence/analytics", "Product Analytics"),
        intel("intelligence/channels", "Channels"),
      ].filter(notNull),
      true,
    ),
    topicGroup(
      "Hosting",
      "sidebar#intelligence-hosting",
      [
        intel("intelligence/managed-intelligence-platform", "Cloud-hosted"),
        intel("intelligence/self-hosting", "Self-hosted"),
        intel("intelligence/self-hosting-ecs", "AWS ECS/Fargate"),
        intel("intelligence/self-hosting-local", "Local evaluation"),
      ].filter(notNull),
    ),
  ]);

  // Backend
  const existingBackend = sectionChildren(input, "Backend");
  const inputDeployment = sectionChildren(input, "Deployment");
  const runtimeSource =
    findGroup(existingBackend, "Runtime") ??
    findGroup(inputDeployment, "Runtime") ??
    sectionChildren(input, "Runtime");
  const deploymentSource =
    findGroup(existingBackend, "Deployment") ??
    inputDeployment.filter(
      (n) => !(n.type === "group" && n.title === "Runtime"),
    );
  const inspector = findPage("inspector");
  const debuggingSource =
    findGroup(existingBackend, "Debugging") ??
    uniqueSidebarNodes([
      ...sectionChildren(input, "Observe & Operate"),
      ...(inspector ? [inspector] : []),
    ]);

  // Learn and Other
  const conceptsSource =
    findGroup(sectionChildren(input, "Learn"), "Concepts") ??
    sectionChildren(input, "Concepts");
  const frontendGuides = uniqueSidebarNodes([
    ...frontendGettingStartedExtras,
    ...sectionChildren(input, "Angular Guides"),
  ]);
  const inputOther = sectionChildren(input, "Other");
  const canonicalOther = sectionChildren(canonical, "Other");
  const contributing =
    findGroup(inputOther, "Contributing") ??
    findGroup(canonicalOther, "Contributing");
  const troubleshooting =
    findGroup(inputOther, "Troubleshooting") ??
    findGroup(sectionChildren(input, "Troubleshooting"), "Troubleshooting") ??
    topicGroup(
      "Troubleshooting",
      "sidebar#troubleshooting-source",
      flattenUntitledGroups(sectionChildren(input, "Troubleshooting")),
    );
  const otherPage = (slug: string) =>
    findNavNode(
      [...inputOther, ...canonicalOther],
      (n) => n.type === "page" && withoutRouteGroupSlug(n.slug) === slug,
    ) ?? findPage(slug);
  const telemetry = otherPage("telemetry");
  const communityFrameworks = otherPage("community-frameworks");

  return [
    ...startLinks,
    ...sidebarSection("Basics", [
      topicGroup("Chat", "sidebar#chat", uniqueSidebarNodes(chatSource)),
      topicGroup("Threads", "sidebar#threads-ui", threadUi),
      asPage(findPage("frontend-tools"), "Frontend tools"),
    ]),
    ...sidebarSection("Generative UI", [
      generativeTopic("Controlled"),
      generativeTopic("Declarative"),
      generativeTopic("Open-Ended", "Open-ended"),
    ]),
    ...sidebarSection("Interactivity", [
      topicGroup("Shared state", "sidebar#shared-state", sharedState),
      topicGroup(
        "Human-in-the-loop",
        "sidebar#human-in-the-loop",
        humanInTheLoop,
      ),
      asPage(findPage("webmcp"), "WebMCP"),
    ]),
    ...sidebarSection("Agent capabilities", [
      ...frameworkGroups,
      asPage(findPage("multi-agent/subagents"), "Sub-agents"),
    ]),
    ...intelligence,
    ...sidebarSection("Backend", [
      topicGroup("Runtime", "sidebar#runtime", runtimeSource),
      topicGroup(
        "Deployment",
        "sidebar#deployment",
        Array.isArray(deploymentSource)
          ? flattenUntitledGroups(deploymentSource)
          : deploymentSource,
      ),
      topicGroup("Debugging", "sidebar#debugging", debuggingSource),
    ]),
    ...sidebarSection("Learn", [
      topicGroup(
        "Concepts",
        "sidebar#concepts",
        Array.isArray(conceptsSource)
          ? flattenUntitledGroups(conceptsSource)
          : conceptsSource,
      ),
      topicGroup("Angular guides", "sidebar#angular-guides", frontendGuides),
      { type: "page", title: "Cookbook", slug: "cookbook", href: "/cookbook" },
      {
        type: "page",
        title: "Reference",
        slug: "reference",
        href: "/reference",
      },
    ]),
    ...sidebarSection("Other", [
      contributing
        ? topicGroup(
            "Contributing",
            "sidebar#contributing",
            withoutRouteGroupSegments(contributing),
          )
        : null,
      troubleshooting
        ? topicGroup(
            "Troubleshooting",
            "sidebar#troubleshooting",
            troubleshooting,
          )
        : null,
      telemetry?.type === "page"
        ? {
            ...withoutRouteGroupSegments(telemetry),
            title: "Open-source telemetry",
          }
        : null,
      communityFrameworks?.type === "page"
        ? withoutRouteGroupSegments(communityFrameworks)
        : null,
    ]),
  ];
}
