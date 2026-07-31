import { expect, test, vi } from "vitest";
import fs from "fs";
import matter from "gray-matter";

vi.mock("../registry", () => ({ getDocsMode: () => "generated" }));

import { inlineSnippets } from "../docs-render";

const canonicalGuidePath = "/premium/existing-app-hosted-intelligence";
const canonicalGuideContentPath =
  "docs/premium/existing-app-hosted-intelligence.mdx";
const hostedRuntimeSnippetPath =
  "snippets/shared/premium/existing-app-hosted-intelligence-platform-runtime.mdx";
const hostedGuideVariants = [
  {
    name: "Angular",
    path: "docs/frontends/angular/premium/existing-app-hosted-intelligence.mdx",
    handoff: "/angular/guides/threads-memory-attachments-headless",
  },
  {
    name: "Vue",
    path: "docs/frontends/vue/premium/existing-app-hosted-intelligence.mdx",
    handoff: "/reference/vue/hooks/useThreads",
  },
  {
    name: "React Native",
    path: "docs/frontends/react-native/premium/existing-app-hosted-intelligence.mdx",
    handoff: "/reference/react-native/hooks/useThreads",
  },
] as const;
const hostedGuideWrappers = [
  { name: "React", path: canonicalGuideContentPath },
  ...hostedGuideVariants,
] as const;
const runtimeSetupLead =
  "Replace the single-method handler with the Intelligence and multi-method handler setup shown here.";
const runnerException =
  "One exception: if those options include an explicit `runner`, remove it before adding `intelligence`; the two select different Runtime modes.";
const drawerEntryPointPath =
  "snippets/shared/basics/copilot-threads-drawer.mdx";
const drawerWrapperSourceUrl = new URL(
  "../../../../../packages/react-core/src/v2/components/chat/CopilotThreadsDrawer.tsx",
  import.meta.url,
);
const reactRouterRouteSourceUrl = new URL(
  "../../../../../examples/v2/react-router/app/routes/api.copilotkit.$.tsx",
  import.meta.url,
);
const useThreadsSourceUrl = new URL(
  "../../../../../packages/react-core/src/v2/hooks/use-threads.tsx",
  import.meta.url,
);
const headlessEntryPointPath = "snippets/shared/threads/headless-threads.mdx";
const drawerReferencePath = "reference/components/CopilotThreadsDrawer.mdx";
const useThreadsReferencePath = "reference/hooks/useThreads.mdx";
const entryPointPaths = [
  "snippets/shared/cli/cli.mdx",
  "docs/premium/managed-intelligence-platform.mdx",
  "docs/integrations/built-in-agent/quickstart.mdx",
  drawerEntryPointPath,
  headlessEntryPointPath,
];

interface MdxCodeFence {
  language: string;
  title: string | undefined;
  content: string;
}

function readContent(relativePath: string): string {
  return fs.readFileSync(
    new URL(`../../content/${relativePath}`, import.meta.url),
    "utf8",
  );
}

/** Render a hosted guide through the production snippet inliner. */
function readRenderedHostedGuide(relativePath: string): string {
  return inlineSnippets(readContent(relativePath), relativePath);
}

/** Read the rendered React wrapper used for the canonical guide contract. */
function readCanonicalGuide(): string {
  return readRenderedHostedGuide(canonicalGuideContentPath);
}

/** Collapse prose whitespace so line wrapping does not affect contract checks. */
function collapseWhitespace(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

/** Extract TSDoc comments without coupling documentation checks to implementation code. */
function extractTsdocComments(source: string): string {
  return Array.from(
    source.matchAll(/\/\*\*[\s\S]*?\*\//g),
    (match) => match[0],
  ).join("\n");
}

function expectPageImmediatelyAfter(
  pages: unknown[],
  target: string,
  anchor: string,
): void {
  const anchorIndex = pages.indexOf(anchor);

  expect(anchorIndex).toBeGreaterThanOrEqual(0);
  expect(pages.filter((page) => page === target)).toHaveLength(1);
  expect(pages.indexOf(target)).toBe(anchorIndex + 1);
}

function findUnsafeManagedIdentifiers(
  canonicalGuide: string,
  entryPoints: string[],
): string[] {
  const environmentIdentifiers = [canonicalGuide, ...entryPoints].flatMap(
    (content) =>
      content.match(
        /(?<![A-Za-z0-9_])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![A-Za-z0-9_])/g,
      ) ?? [],
  );

  return environmentIdentifiers.filter(
    (identifier) =>
      identifier !== "CPK_INTELLIGENCE_API_KEY" &&
      /(?:^|_)INTELLIGENCE_(?:API_KEY|API_URL|GATEWAY_WS_URL)(?:_|$)/.test(
        identifier,
      ),
  );
}

/** Extract destinations from rendered Markdown links in MDX source. */
function extractMarkdownLinkDestinations(content: string): string[] {
  const withoutComments = content.replace(
    /\{\/\*[\s\S]*?\*\/\}|<!--[\s\S]*?-->/g,
    " ",
  );
  let fenceMarker: string | undefined;
  const visibleContent = withoutComments
    .split("\n")
    .filter((line) => {
      const fenceMatch = line.match(/^\s*([`~])\1{2,}/);
      if (!fenceMatch) return !fenceMarker;

      const marker = fenceMatch[1];
      fenceMarker =
        marker === fenceMarker ? undefined : (fenceMarker ?? marker);
      return false;
    })
    .join("\n");

  return Array.from(
    visibleContent.matchAll(
      /(?<!!)\[[^\]\n]+\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/g,
    ),
    (match) => match[1] ?? match[2],
  );
}

/** Assert that MDX source links to the canonical guide path. */
function expectCanonicalGuideLink(content: string): void {
  const destinations = extractMarkdownLinkDestinations(content);

  expect(
    destinations.some(
      (destination) => destination.split(/[?#]/, 1)[0] === canonicalGuidePath,
    ),
  ).toBe(true);
}

/** Assert that each owned entry point omits its retired setup syntax. */
function expectNoRetiredThreadSetup(
  contentsByPath: ReadonlyMap<string, string>,
): void {
  expect(contentsByPath.has(drawerEntryPointPath)).toBe(true);
  expect(contentsByPath.has(headlessEntryPointPath)).toBe(true);

  expect(contentsByPath.get(drawerEntryPointPath) ?? "").not.toMatch(
    /\bpublicLicenseKey\s*=/,
  );
  expect(contentsByPath.get(headlessEntryPointPath) ?? "").not.toMatch(
    /\bimport\s*(?:type\s+)?\{[^}]*\bCopilotRuntime\b[^}]*\}\s*from\s*(["'])@copilotkit\/runtime\1/,
  );
}

/** Build the path-keyed entry-point fixture used by retired-code checks. */
function createEntryPointFixture(
  drawerContent: string,
  headlessContent: string,
  reverseOrder = false,
): ReadonlyMap<string, string> {
  const drawerEntry = [drawerEntryPointPath, drawerContent] as const;
  const headlessEntry = [headlessEntryPointPath, headlessContent] as const;

  return new Map(
    reverseOrder ? [headlessEntry, drawerEntry] : [drawerEntry, headlessEntry],
  );
}

/** Extract Markdown code fences with their language and optional title. */
function extractMdxCodeFences(content: string): MdxCodeFence[] {
  return Array.from(
    content.matchAll(
      /^[ \t]*(`{3,}|~{3,})[ \t]*([^\r\n]*)\r?\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm,
    ),
    (match) => {
      const info = (match[2] ?? "").trim();
      const titleMatch = info.match(/\btitle=(?:"([^"]+)"|'([^']+)')/);

      return {
        language: info.split(/\s+/, 1)[0] ?? "",
        title: titleMatch?.[1] ?? titleMatch?.[2],
        content: match[3] ?? "",
      };
    },
  );
}

/** Return the sole code fence with the requested language, title, and marker. */
function findMdxCodeFence(
  fences: MdxCodeFence[],
  language: string,
  title: string,
  marker?: string,
): string {
  const matches = fences.filter(
    (fence) =>
      fence.language === language &&
      fence.title === title &&
      (!marker || fence.content.includes(marker)),
  );
  const [match] = matches;

  if (matches.length !== 1 || !match) {
    throw new Error(
      `Expected one ${language} fence titled ${title}${marker ? ` containing ${marker}` : ""}`,
    );
  }

  return match.content;
}

/** Return the sole CLI snippet fence with the requested language and title. */
function findCliCodeFence(language: string, title: string): string {
  return findMdxCodeFence(
    extractMdxCodeFences(readContent("snippets/shared/cli/cli.mdx")),
    language,
    title,
  );
}

/** Assert that a React Router route delegates its native loader/action surface to the Fetch handler. */
function expectReactRouterAdapterContract(routeSource: string): void {
  expect(routeSource).toMatch(
    /import type \{ Route \} from ["']\.\/\+types\/api\.copilotkit\.\$["'];/,
  );
  expect(routeSource).toMatch(
    /export async function loader\(\{ request \}: Route\.LoaderArgs\) \{\s*return handler\(request\);\s*\}/,
  );
  expect(routeSource).toMatch(
    /export async function action\(\{ request \}: Route\.ActionArgs\) \{\s*return handler\(request\);\s*\}/,
  );

  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    expect(routeSource).not.toContain(`export const ${method} = handler`);
  }
}

/** Assert the canonical guide's managed Runtime, auth, and UI contracts. */
function expectCanonicalGuideContracts(guide: string): void {
  const { data: frontmatter, content } = matter(guide);
  const fences = extractMdxCodeFences(content);
  const serverRoute = findMdxCodeFence(
    fences,
    "ts",
    "app/api/copilotkit/[[...slug]]/route.ts",
  );
  const appPage = findMdxCodeFence(fences, "tsx", "app/page.tsx");

  expect(frontmatter.doc_type).toBe("how-to");
  expect(content).toContain('surface="docs_existing_app_hosted_intelligence"');
  expect(content).toContain("CPK_TELEMETRY_ID");
  expect(content).toContain("two real app accounts");
  expect(content).toContain(
    "The ID must be 1–128 characters and may contain only ASCII letters (`A`–`Z` and `a`–`z`), ASCII digits (`0`–`9`), `_`, `.`, `@`, `:`, `=`, or `-`.",
  );
  expect(content).toContain(`${runnerException} ${runtimeSetupLead}`);

  expect(serverRoute).toMatch(
    /const intelligenceApiKey\s*=\s*process\.env\.CPK_INTELLIGENCE_API_KEY\?\.trim\(\);/,
  );
  expect(serverRoute).not.toContain("runner");
  expect(serverRoute).toMatch(
    /if\s*\(!intelligenceApiKey\)\s*\{\s*throw new Error\("CPK_INTELLIGENCE_API_KEY is required"\);\s*\}/,
  );
  expect(serverRoute).toContain("const runtime = new CopilotRuntime({");
  expect(serverRoute).toContain("intelligence: new CopilotKitIntelligence({");
  expect(serverRoute).toContain("apiKey: intelligenceApiKey");
  expect(serverRoute).toContain(
    'apiUrl: "https://api.intelligence.copilotkit.ai"',
  );
  expect(serverRoute).toContain(
    'wsUrl: "wss://realtime.intelligence.copilotkit.ai"',
  );
  expect(serverRoute).toMatch(
    /identifyUser\s*:\s*async\s*\(request\)\s*=>\s*\{[\s\S]*?getVerifiedAppUser\(request\)[\s\S]*?return\s*\{\s*id:\s*user\.id,\s*name:\s*user\.name\s*\}/,
  );
  expect(serverRoute).toMatch(
    /onRequest\s*:\s*async\s*\(\{\s*request\s*\}\)\s*=>\s*\{[\s\S]*?getVerifiedAppUser\(request\)[\s\S]*?if\s*\(!user\)\s*\{[\s\S]*?status:\s*401/,
  );

  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    expect(serverRoute).toContain(`export const ${method} = handler`);
  }

  const runtimeProvider = appPage.match(
    /<CopilotKitProvider\b([^>]*)>([\s\S]*?)<\/CopilotKitProvider>/,
  );
  const runtimeProviderProps = runtimeProvider?.[1] ?? "";
  const runtimeProviderChildren = runtimeProvider?.[2] ?? "";
  const configurationProviders = Array.from(
    runtimeProviderChildren.matchAll(
      /<CopilotChatConfigurationProvider\b[^>]*>([\s\S]*?)<\/CopilotChatConfigurationProvider>/g,
    ),
  );
  const sharedChatChildren = configurationProviders[0]?.[1] ?? "";

  expect(runtimeProvider).not.toBeNull();
  expect(runtimeProviderProps).toContain('runtimeUrl="/api/copilotkit"');
  expect(runtimeProviderProps).toContain("useSingleEndpoint={false}");
  expect(
    appPage.match(/<CopilotChatConfigurationProvider\b/g) ?? [],
  ).toHaveLength(1);
  expect(configurationProviders).toHaveLength(1);
  expect(sharedChatChildren).toMatch(/<CopilotThreadsDrawer\b[^>]*\/>/);
  expect(sharedChatChildren).toMatch(/<CopilotChat\b[^>]*\/>/);
}

test("lists the existing-app guide in both Intelligence navigation files", () => {
  const rootMeta = JSON.parse(readContent("docs/meta.json")) as {
    pages: unknown[];
  };
  const premiumMeta = JSON.parse(readContent("docs/premium/meta.json")) as {
    pages: unknown[];
  };

  expectPageImmediatelyAfter(
    rootMeta.pages,
    "premium/existing-app-hosted-intelligence",
    "premium/managed-intelligence-platform",
  );
  expectPageImmediatelyAfter(
    premiumMeta.pages,
    "existing-app-hosted-intelligence",
    "managed-intelligence-platform",
  );
});

test.each([
  {
    caseName: "a missing anchor when the target is first",
    pages: ["existing-app-hosted-intelligence"],
    target: "existing-app-hosted-intelligence",
    anchor: "managed-intelligence-platform",
  },
  {
    caseName: "a duplicate target after the anchor",
    pages: [
      "managed-intelligence-platform",
      "existing-app-hosted-intelligence",
      "existing-app-hosted-intelligence",
    ],
    target: "existing-app-hosted-intelligence",
    anchor: "managed-intelligence-platform",
  },
])("rejects $caseName", ({ pages, target, anchor }) => {
  expect(() => expectPageImmediatelyAfter(pages, target, anchor)).toThrow();
});

test("documents the managed Runtime, auth, UI, and verification contracts", () => {
  const guide = readCanonicalGuide();

  expectCanonicalGuideContracts(guide);
});

test.each(hostedGuideWrappers)(
  "$name wrapper renders the shared hosted Runtime/platform guide",
  ({ path }) => {
    const sharedRuntimePlatformContent = readContent(hostedRuntimeSnippetPath);

    const guide = readRenderedHostedGuide(path);

    expect(guide).toContain(sharedRuntimePlatformContent);
    expect(guide).not.toContain("<HostedIntelligencePlatformRuntime");
  },
);

test("the canonical key-rotation link resolves to the supported replacement sequence", () => {
  const guide = readCanonicalGuide();
  const cli = readContent("snippets/shared/cli/cli.mdx");
  const rotationLinkLine =
    guide
      .split("\n")
      .find((line) => line.includes("dashboard key-rotation sequence")) ?? "";
  const sectionStart = cli.indexOf("## Rotate a project API key");
  const sectionEnd = cli.indexOf("## Skills commands", sectionStart);

  expect(extractMarkdownLinkDestinations(rotationLinkLine)).toContain("/cli");
  expect(sectionStart).toBeGreaterThanOrEqual(0);
  expect(sectionEnd).toBeGreaterThan(sectionStart);

  const section = cli.slice(sectionStart, sectionEnd);
  const orderedSteps = [
    "### Create a replacement",
    "### Update the running app",
    "### Verify the replacement",
    "### Revoke the old key",
  ];
  let previousStepIndex = -1;

  for (const step of orderedSteps) {
    const stepIndex = section.indexOf(step);

    expect(stepIndex).toBeGreaterThan(previousStepIndex);
    previousStepIndex = stepIndex;
  }

  expect(section).toContain(
    "[hosted dashboard](https://dashboard.operations.copilotkit.ai)",
  );
  expect(section).toContain("**API Keys**");
  expect(section).toContain("**Create API key**");
  expect(section).toContain("The full token is shown once");
  expect(section).toContain("`CPK_INTELLIGENCE_API_KEY`");
  expect(section).toContain("Keep the old key active");
  expect(section).toMatch(/\b(?:restart|redeploy)\b/);
  expect(section).toContain("create a new Thread");
  expect(section).toContain("**Delete API key**");
  expect(section).toContain("revokes it immediately");
  expect(section).not.toMatch(
    /npx copilotkit@latest\s+(?:api-keys?|keys?)\s+(?:delete|revoke)/,
  );
});

test("documents framework-native registration for the same four HTTP methods", () => {
  const guide = readCanonicalGuide();
  const headlessGuide = readContent(headlessEntryPointPath);
  const reactRouterExample = fs.readFileSync(reactRouterRouteSourceUrl, "utf8");
  const reactRouterGuideRoute = findMdxCodeFence(
    extractMdxCodeFences(guide),
    "ts",
    "app/routes/api.copilotkit.$.tsx",
  );

  expectReactRouterAdapterContract(reactRouterExample);
  expectReactRouterAdapterContract(reactRouterGuideRoute);
  expect(headlessGuide).toMatch(
    /Next\.js App Router[^.]*`GET`, `POST`, `PATCH`, and `DELETE` named exports/,
  );
  expect(headlessGuide).toMatch(
    /React Router[^.]*`loader`[^.]*`GET`[^.]*`action`[^.]*`POST`, `PATCH`, and `DELETE`/,
  );
  expect(headlessGuide).not.toContain(
    "handler hooks, and four HTTP exports in your Runtime route",
  );
});

test("rejects a guide that omits the explicit runner exception", () => {
  const guide = readCanonicalGuide();
  const guideWithoutException = guide.replace(runnerException, "");

  expect(guideWithoutException).not.toContain(runnerException);
  expect(() => expectCanonicalGuideContracts(guideWithoutException)).toThrow();
});

test.each([
  {
    caseName: "identifyUser callback with only a prose mention left",
    mutateGuide: (guide: string) =>
      `${guide.replace(
        /      identifyUser: async \(request\) => \{[\s\S]*?\n      \},\n/,
        "",
      )}\n\nThe \`identifyUser\` callback remains required.\n`,
    removedPattern: /identifyUser: async \(request\)/,
  },
  {
    caseName: "onRequest auth gate with only a prose mention left",
    mutateGuide: (guide: string) =>
      `${guide.replace(
        /      hooks: \{\n        onRequest: async \(\{ request \}\) => \{[\s\S]*?\n        \},\n      \},\n/,
        "",
      )}\n\nThe \`onRequest\` auth gate remains required.\n`,
    removedPattern: /onRequest: async \(\{ request \}\)/,
  },
  {
    caseName: "Drawer JSX with only a prose mention left",
    mutateGuide: (guide: string) =>
      `${guide.replace(
        /^[ \t]*<CopilotThreadsDrawer \/>$/m,
        "          {/* Drawer omitted */}",
      )}\n\nKeep \`<CopilotThreadsDrawer />\` in the page.\n`,
    removedPattern: /^[ \t]*<CopilotThreadsDrawer \/>$/m,
  },
])("rejects a missing $caseName", ({ mutateGuide, removedPattern }) => {
  const guide = readCanonicalGuide();
  const mutatedGuide = mutateGuide(guide);

  expect(mutatedGuide).not.toMatch(removedPattern);
  expect(() => expectCanonicalGuideContracts(mutatedGuide)).toThrow();
});

test("checks user B's successful agent-scoped list for user A's thread", () => {
  const guide = readCanonicalGuide();

  expect(guide).toContain(
    "`${runtimeUrl}/threads?agentId=${encodeURIComponent(agentId)}`",
  );
  expect(guide).toMatch(
    /if \(!listResponse\.ok\) \{[\s\S]*?throw new Error\([\s\S]*?\);[\s\S]*?\}[\s\S]*?const listBody = await listResponse\.json\(\);/,
  );
  expect(guide).toMatch(
    /if \(listBody\.threads\.some\(\(thread\) => thread\.id === threadId\)\) \{[\s\S]*?throw new Error/,
  );
});

test("replaces the Quickstart Runtime route with one hosted catch-all route", () => {
  const quickstart = readContent(
    "docs/integrations/built-in-agent/quickstart.mdx",
  );
  const guide = readCanonicalGuide();

  expect(quickstart).toContain("app/api/copilotkit/route.ts");
  expect(guide).toContain(
    "Move the Runtime setup from `app/api/copilotkit/route.ts` to `app/api/copilotkit/[[...slug]]/route.ts`, then delete the old `app/api/copilotkit/route.ts`. Keep only the catch-all route.",
  );
});

test("links each public entry point back to the canonical guide", () => {
  const contentsByPath = new Map(
    entryPointPaths.map((path) => [path, readContent(path)]),
  );
  const contents = [...contentsByPath.values()];

  for (const content of contents) {
    expectCanonicalGuideLink(content);
  }

  expect(findUnsafeManagedIdentifiers(readCanonicalGuide(), contents)).toEqual(
    [],
  );
  expectNoRetiredThreadSetup(contentsByPath);
});

test("documents only customization accepted and forwarded by the React Drawer wrapper", () => {
  const drawerGuide = readContent(drawerEntryPointPath);
  const drawerReference = readContent(drawerReferencePath);
  const collapsedDrawerReference = collapseWhitespace(drawerReference);
  const drawerWrapperSource = fs.readFileSync(drawerWrapperSourceUrl, "utf8");
  const propsInterface =
    drawerWrapperSource.match(
      /export interface CopilotThreadsDrawerProps \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";
  const wrapperArguments =
    drawerWrapperSource.match(
      /export function CopilotThreadsDrawer\(\{([\s\S]*?)\}: CopilotThreadsDrawerProps\)/,
    )?.[1] ?? "";

  expect(propsInterface).not.toMatch(/^\s*children\??\s*:/m);
  expect(propsInterface).toMatch(/\brenderRow\?:/);
  expect(wrapperArguments).not.toMatch(/\bchildren\b/);
  expect(drawerWrapperSource).toMatch(
    /React\.createElement\([\s\S]*COPILOTKIT_THREADS_DRAWER_TAG[\s\S]*rowChildren/,
  );
  expect(drawerGuide).not.toMatch(
    /<CopilotThreadsDrawer\b[^>]*>\s*<span\b[^>]*\bslot=["']header["']/,
  );
  for (const fence of extractMdxCodeFences(drawerReference)) {
    expect(fence.content).not.toMatch(
      /<CopilotThreadsDrawer\b[^>]*>[\s\S]*?\bslot\s*=/,
    );
  }
  expect(drawerReference).not.toContain('slot="header"');
  expect(drawerReference).not.toContain("`launcher-icon`");
  expect(collapsedDrawerReference).toContain(
    "The React wrapper does not forward arbitrary children to the custom element.",
  );

  const customizationExample = findMdxCodeFence(
    extractMdxCodeFences(drawerGuide),
    "tsx",
    "app/threads-drawer.tsx",
  );

  expect(customizationExample).toContain(
    'import { CopilotThreadsDrawer } from "@copilotkit/react-core/v2";',
  );
  expect(customizationExample).toContain('label="My conversations"');
  expect(customizationExample).toContain("renderRow={(thread) => (");
  expect(customizationExample).toContain(
    '<span>{thread.name ?? "New conversation"}</span>',
  );
});

test.each([
  {
    path: "docs/premium/managed-intelligence-platform.mdx",
    sectionStart: "Thread actions map to the same lifecycle",
    sectionEnd: "Use the thread detail page",
  },
  {
    path: headlessEntryPointPath,
    sectionStart: "**Archive vs. delete:**",
    sectionEnd: "      </Step>",
  },
  {
    path: useThreadsReferencePath,
    sectionStart: '<PropertyReference name="archiveThread"',
    sectionEnd: "## Usage",
  },
])(
  "$path matches the hosted thread removal contract",
  ({ path, sectionStart, sectionEnd }) => {
    const content = readContent(path);
    const startIndex = content.indexOf(sectionStart);
    const endIndex = content.indexOf(
      sectionEnd,
      startIndex + sectionStart.length,
    );

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    const lifecycle = content
      .slice(startIndex, endIndex)
      .replace(/`/g, "")
      .replace(/\s+/g, " ");

    expect(lifecycle).not.toMatch(
      /\barchive(?:Thread)?\b[^.]*\bsoft delete\b/i,
    );
    expect(lifecycle).not.toMatch(
      /\bdelete(?:Thread)?\b[^.]*\bpermanently removes?\b|\bremoved entirely\b/i,
    );
    expect(lifecycle).toMatch(/\barchive(?:Thread)?\b[^.]*\breversible\b/i);
    expect(lifecycle).toContain("includeArchived: true");
    expect(lifecycle).toMatch(/\bunarchive(?:Thread)?\b/i);
    expect(lifecycle).toMatch(
      /\bdelete(?:Thread)?\b[^.]*\birreversible to the app user\b/i,
    );
    expect(lifecycle).toMatch(/\bsoft-deletes?\b/i);
    expect(lifecycle).toMatch(/\bretains?\b[^.]*\b(?:stored )?row\b/i);
    expect(lifecycle).not.toMatch(
      /\b(?:physically|permanently)\s+(?:remove|removes|removed)\b/i,
    );
    expect(lifecycle).not.toMatch(
      /\b\d+\s+(?:hours?|days?|weeks?|months?|years?)\b/i,
    );
  },
);

test("T1: publishes framework-native variants of the hosted existing-app guide", () => {
  const { data: frontmatter } = matter(readContent(canonicalGuideContentPath));

  expect.soft(frontmatter.frontend, "root guide frontend metadata").toEqual({
    kind: "frontend-variant",
    fallback: "hide",
  });

  for (const variant of hostedGuideVariants) {
    const variantUrl = new URL(
      `../../content/${variant.path}`,
      import.meta.url,
    );
    const exists = fs.existsSync(variantUrl);

    expect.soft(exists, `${variant.name} hosted guide variant`).toBe(true);
    if (!exists) continue;

    const content = readContent(variant.path);
    const linkDestinations = extractMarkdownLinkDestinations(content).map(
      (destination) => destination.split(/[?#]/, 1)[0],
    );
    const code = extractMdxCodeFences(content)
      .map((fence) => fence.content)
      .join("\n");

    expect(linkDestinations).toContain(variant.handoff);
    expect(code).not.toMatch(
      /\bimport\s+(?:type\s+)?\{[^}]*\b(?:CopilotKitProvider|CopilotThreadsDrawer|useThreads)\b[^}]*\}\s+from\s+["']@copilotkit\/react(?:-core)?(?:\/v2)?["']/,
    );
    expect(code).not.toMatch(/<(?:CopilotKitProvider|CopilotThreadsDrawer)\b/);
    expect(code).not.toMatch(/\buseThreads\s*\(/);
  }
});

test("Angular public API inventory lists public thread entry points", () => {
  const inventory = readContent("reference/angular/public-api.mdx");
  const rootApiFamilies =
    inventory.match(
      /## Root API families([\s\S]*?)## MCP Apps API family/,
    )?.[1] ?? "";
  const completeUiFamily =
    rootApiFamilies.match(
      /- \*\*Complete UI:\*\*([\s\S]*?)(?=- \*\*|$)/,
    )?.[0] ?? "";
  const applicationStateFamily =
    rootApiFamilies.match(
      /- \*\*Agents and application state:\*\*([\s\S]*?)(?=- \*\*|$)/,
    )?.[0] ?? "";

  expect(completeUiFamily).toContain("`CopilotThreadsDrawer`");
  expect(applicationStateFamily).toContain("`injectThreads`");
});

test.each([
  {
    surface: "threads explanation",
    read: () => readContent("docs/premium/threads-explained.mdx"),
    archiveContract: true,
    deleteContract: true,
    paginationContract: false,
    optimisticContract: true,
    orderingContract: false,
  },
  {
    surface: "Angular headless threads guide",
    read: () =>
      readContent(
        "docs/frontends/angular/guides/threads-memory-attachments-headless.mdx",
      ),
    archiveContract: false,
    deleteContract: true,
    paginationContract: false,
    optimisticContract: false,
    orderingContract: false,
  },
  {
    surface: "Vue useThreads reference",
    read: () => readContent("reference/vue/hooks/useThreads.mdx"),
    archiveContract: true,
    deleteContract: true,
    paginationContract: true,
    optimisticContract: true,
    orderingContract: true,
  },
  {
    surface: "React Native useThreads reference",
    read: () => readContent("reference/react-native/hooks/useThreads.mdx"),
    archiveContract: true,
    deleteContract: true,
    paginationContract: true,
    optimisticContract: true,
    orderingContract: true,
  },
  {
    surface: "React useThreads TSDoc",
    read: () =>
      extractTsdocComments(fs.readFileSync(useThreadsSourceUrl, "utf8")),
    archiveContract: true,
    deleteContract: true,
    paginationContract: true,
    optimisticContract: true,
    orderingContract: true,
  },
  {
    surface: "Angular injectThreads TSDoc",
    read: () =>
      extractTsdocComments(
        fs.readFileSync(
          new URL(
            "../../../../../packages/angular/src/lib/threads.ts",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    archiveContract: true,
    deleteContract: true,
    paginationContract: true,
    optimisticContract: true,
    orderingContract: true,
  },
])(
  "T2: $surface matches the cross-frontend thread contract",
  ({
    surface,
    read,
    archiveContract,
    deleteContract,
    paginationContract,
    optimisticContract,
    orderingContract,
  }) => {
    const content = collapseWhitespace(read().replace(/`/g, ""));

    expect.soft(content, `${surface}: content loads`).not.toHaveLength(0);

    if (archiveContract) {
      expect
        .soft(content, `${surface}: archive is a reversible visibility state`)
        .toMatch(/\barchive(?:Thread)?\b[^.]*\breversible visibility state\b/i);
      expect
        .soft(content, `${surface}: archived rows can be included`)
        .toContain("includeArchived: true");
      expect
        .soft(content, `${surface}: unarchive restores the active row`)
        .toMatch(/\bunarchive(?:Thread|d)?\b[^.]*\brestores?\b/i);
      expect
        .soft(content, `${surface}: archive is not described as soft-delete`)
        .not.toMatch(/\barchive(?:Thread)?\b[^.]*\bsoft[ -]?delete\b/i);
    }

    if (deleteContract) {
      expect
        .soft(content, `${surface}: delete is irreversible to the app user`)
        .toMatch(
          /\b(?:delete(?:Thread)?|deletion)\b[^.]*\birreversible to (?:the )?app user\b/i,
        );
      expect
        .soft(content, `${surface}: the platform soft-deletes`)
        .toMatch(/\bplatform\b[^.]*\bsoft-deletes?\b/i);
      expect
        .soft(content, `${surface}: the platform retains the stored row`)
        .toMatch(/\bretains?\b[^.]*\bstored row\b/i);
      expect
        .soft(content, `${surface}: delete does not promise a purge window`)
        .not.toMatch(
          /\b(?:delete(?:Thread)?|deletion)\b[^.]*\b\d+\s+(?:hours?|days?|weeks?|months?|years?)\b/i,
        );
      expect
        .soft(content, `${surface}: delete does not claim physical row removal`)
        .not.toMatch(
          /\b(?:delete(?:Thread)?|deletion)\b[^.]*\bpermanent\b|\bpermanently\b[^.]*\bdelete\b|\b(?:row|record|history)\b[^.]*\b(?:removed?|deleted?)\b[^.]*\b(?:entirely|physically)\b/i,
        );
    }

    if (paginationContract) {
      expect
        .soft(content, `${surface}: cursor pages default to 50 rows`)
        .toMatch(
          /\b(?:default page size (?:is|of)|default is|defaults? to) 50(?: threads)? per page\b/i,
        );
      expect
        .soft(content, `${surface}: limit only overrides page size`)
        .toMatch(
          /\blimit\b[^.]*\boverrides?\b[^.]*\bpage size\b|\boverrides? the thread page size\b/i,
        );
      expect
        .soft(content, `${surface}: cursor pagination works without limit`)
        .toMatch(
          /\bcursor(?:-based)? pagination\b[^.]*\b(?:remains active when (?:this|limit) is omitted|without (?:a )?limit)\b/i,
        );
      expect
        .soft(content, `${surface}: limit is not required for pagination`)
        .not.toMatch(
          /\bonly meaningful when limit is set\b|\blimit\b[^.]*\benables? cursor-based pagination\b|\bcursor-based pagination\b[^.]*\bwhen (?:a )?limit is (?:provided|set)\b/i,
        );
    }

    if (optimisticContract) {
      expect
        .soft(content, `${surface}: all four mutations are optimistic`)
        .toMatch(
          /\brename\b[\s\S]{0,120}\barchive\b[\s\S]{0,80}\bunarchive\b[\s\S]{0,80}\bdelete\b[\s\S]{0,220}\boptimistic(?:ally)?\b/i,
        );
      expect
        .soft(content, `${surface}: rejected delete restores its row`)
        .toMatch(
          /\b(?:rejected delete|delete[^.]*\b(?:rejects?|fails?|failure)\b)[^.]*\b(?:restores?|rolls? back)\b[^.]*\brow\b/i,
        );
      expect
        .soft(content, `${surface}: other failures reconcile`)
        .toMatch(
          /\bother\b[^.]*\b(?:failures|rejected mutations)\b[^.]*\brealtime\b[^.]*\brefetch\b/i,
        );
      expect
        .soft(content, `${surface}: mutations are not pessimistic`)
        .not.toMatch(/\bpessimistic updates?\b/i);
    }

    if (orderingContract) {
      expect
        .soft(
          content,
          `${surface}: newest-first ordering uses all tie-breakers`,
        )
        .toMatch(
          /\blastRunAt\b[^.]*\bupdatedAt\b[^.]*\bcreatedAt\b[^.]*\b(?:most recent|newest)[ -]first\b/i,
        );
      expect
        .soft(content, `${surface}: ordering is not updatedAt-only`)
        .not.toMatch(
          /\bsorted (?:by )?most[ -]recently[ -]updated first\b|\bsorted by updatedAt(?: descending)?\b/i,
        );
    }
  },
);

test("T3: public Drawer TSDoc describes hosted managed entitlement without browser tokens", () => {
  const tsdoc = collapseWhitespace(
    extractTsdocComments(fs.readFileSync(drawerWrapperSourceUrl, "utf8")),
  );
  const browserWithoutToken =
    /(?:\bno\b|\bwithout\b)[^.]*\bbrowser\b[^.]*\b(?:license )?token\b|\bbrowser\b[^.]*(?:\bdoes not\b|\bdoesn't\b|\bnever\b|\bno\b|\bwithout\b)[^.]*\b(?:license )?token\b/i;

  expect
    .soft(tsdoc, "hosted entitlement comes from the Runtime-connected project")
    .toMatch(
      /\b(?:cloud-hosted|hosted)\b[^.]*\bmanaged entitlement\b[^.]*(?:\bIntelligence project\b[^.]*\bconnected to (?:the )?Runtime\b|\bRuntime-connected Intelligence project\b)/i,
    );
  expect
    .soft(tsdoc, "hosted setup sends no license token to the browser")
    .toMatch(browserWithoutToken);
  expect.soft(tsdoc, "retired browser prop").not.toContain("publicLicenseKey");
  expect
    .soft(tsdoc, "retired license-status framing")
    .not.toMatch(
      /\b(?:license gating is two-pronged|no license is configured|runtime reported no license status)\b/i,
    );

  const tokenSentences = tsdoc
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => /\b(?:license )?token\b/i.test(sentence));

  for (const sentence of tokenSentences) {
    if (browserWithoutToken.test(sentence)) continue;

    expect
      .soft(
        sentence,
        "explicit tokens are limited to a separate deployment case",
      )
      .toMatch(/\b(?:self-hosted|offline)\b/i);
    expect
      .soft(sentence, "self-hosted or offline tokens are explicit")
      .toMatch(/\bexplicit\b/i);
    expect
      .soft(sentence, "hosted managed entitlement does not use a token")
      .not.toMatch(/\b(?:cloud-hosted|hosted managed)\b/i);
  }
});

test("the useThreads reference matches optimistic Core mutations", () => {
  const reference = collapseWhitespace(readContent(useThreadsReferencePath));

  expect(reference).toContain(
    '<PropertyReference name="unarchiveThread" type="(threadId: string) => Promise<void>">',
  );
  expect(reference).toContain(
    "Rename, archive, unarchive, and delete update the local thread list optimistically.",
  );
  expect(reference).toContain(
    "A rejected delete restores the removed row; other rejected mutations surface an error and realtime updates or a refetch reconcile the server state.",
  );
  expect(reference).not.toMatch(/\bpessimistic updates\b/i);
});

test("the Drawer reference distinguishes managed entitlements from offline license tokens", () => {
  const reference = collapseWhitespace(readContent(drawerReferencePath));

  expect(reference).toContain(
    "A cloud-hosted app gets its entitlement from the Intelligence project connected to the Runtime.",
  );
  expect(reference).toContain(
    "Self-hosted and offline enterprise setups may use an explicit license token.",
  );
  expect(reference).not.toMatch(/without (?:a )?license key[^.]*locked view/i);
});

test.each([
  [
    "a spaced Drawer license prop",
    '<CopilotThreadsDrawer publicLicenseKey = "stale" />',
    "",
  ],
  [
    "a line-broken Drawer license prop",
    '<CopilotThreadsDrawer\n  publicLicenseKey\n  = "stale"\n/>',
    "",
  ],
  [
    "a single-quoted Runtime import",
    "",
    "import { CopilotRuntime } from '@copilotkit/runtime';",
  ],
  [
    "a multiline Runtime import",
    "",
    'import {\n  CopilotRuntime,\n} from "@copilotkit/runtime";',
  ],
  [
    "a multi-symbol Runtime import",
    "",
    'import { ExperimentalEmptyAdapter, CopilotRuntime } from "@copilotkit/runtime";',
  ],
])("rejects %s", (_caseName, drawer, headless) => {
  expect(() =>
    expectNoRetiredThreadSetup(createEntryPointFixture(drawer, headless)),
  ).toThrow();
});

test("binds retired-code scans to entry-point paths", () => {
  const reorderedContents = createEntryPointFixture(
    'publicLicenseKey="stale"',
    'import { CopilotRuntime } from "@copilotkit/runtime";',
    true,
  );

  expect(() => expectNoRetiredThreadSetup(reorderedContents)).toThrow();
});

test("documents a typed headless thread-selection component boundary", () => {
  const headlessThreads = readContent(headlessEntryPointPath);
  const fences = extractMdxCodeFences(headlessThreads);
  const threadSidebar = findMdxCodeFence(
    fences,
    "tsx",
    "ThreadSidebar.tsx",
    "function ThreadSidebar",
  );
  const app = findMdxCodeFence(fences, "tsx", "App.tsx");

  expect
    .soft(threadSidebar)
    .toMatch(
      /interface ThreadSidebarProps\s*\{\s*onSelectThread:\s*\(threadId:\s*string\)\s*=>\s*void;\s*\}/,
    );
  expect
    .soft(threadSidebar)
    .toMatch(
      /export function ThreadSidebar\(\{\s*onSelectThread\s*\}:\s*ThreadSidebarProps\)/,
    );
  expect
    .soft(threadSidebar)
    .toMatch(
      /<button\s+onClick=\{\(\)\s*=>\s*onSelectThread\(thread\.id\)\}\s*>\s*Open\s*<\/button>/,
    );
  expect
    .soft(threadSidebar.match(/\bonSelectThread\(thread\.id\)/g) ?? [])
    .toHaveLength(1);

  expect
    .soft(app)
    .toContain('import { ThreadSidebar } from "./ThreadSidebar";');
  expect.soft(app.match(/<ThreadSidebar\b/g) ?? []).toHaveLength(1);
  expect(app).toMatch(
    /<ThreadSidebar\s+onSelectThread=\{setActiveThreadId\}\s*\/>/,
  );
});

test("uses one explicit agent ID for the headless thread list and chat", () => {
  const headlessThreads = readContent(headlessEntryPointPath);
  const fences = extractMdxCodeFences(headlessThreads);
  const threadSidebar = findMdxCodeFence(
    fences,
    "tsx",
    "ThreadSidebar.tsx",
    "function ThreadSidebar",
  );
  const app = findMdxCodeFence(fences, "tsx", "App.tsx");
  const listAgentId = threadSidebar.match(
    /useThreads\(\s*\{[\s\S]*?\bagentId\s*:\s*(["'])([^"']+)\1[\s\S]*?\}\s*\)/,
  )?.[2];
  const chatAgentId = app.match(
    /<(?:CopilotChat|CopilotChatConfigurationProvider)\b[^>]*\bagentId\s*=\s*(["'])([^"']+)\1/,
  )?.[2];

  expect.soft(listAgentId).toBe("my-agent");
  expect.soft(chatAgentId).toBeDefined();
  expect(chatAgentId).toBe(listAgentId);
});

test.each([
  drawerEntryPointPath,
  headlessEntryPointPath,
  drawerReferencePath,
  useThreadsReferencePath,
])("%s documents default cursor pagination", (path) => {
  const content = collapseWhitespace(readContent(path));

  expect
    .soft(content)
    .toMatch(/(?:default page size (?:is|of)|defaults? to) 50/i);
  expect.soft(content).toContain("`nextCursor`");
  expect.soft(content).toMatch(/`limit`[^.]*override[^.]*page size/i);
  expect(content).not.toMatch(
    /(?:omit (?:it|`limit`) to load (?:all|the full list)|only meaningful when `limit` is set|`limit`[^.]*enable(?:s)? cursor-based pagination)/i,
  );
});

test("public React TSDoc keeps pagination active when limit is omitted", () => {
  const drawerSource = collapseWhitespace(
    fs.readFileSync(drawerWrapperSourceUrl, "utf8"),
  );
  const useThreadsSource = collapseWhitespace(
    fs.readFileSync(useThreadsSourceUrl, "utf8"),
  );

  for (const source of [drawerSource, useThreadsSource]) {
    expect.soft(source).toMatch(/default[^.]*50 threads per page/i);
    expect.soft(source).toContain("`nextCursor`");
    expect(source).not.toMatch(
      /(?:full list loads at once|Only meaningful when `limit` is set|When set, enables cursor-based pagination)/,
    );
  }
});

test.each([
  ["plain text", `See ${canonicalGuidePath} for setup.`],
  ["an MDX comment", `{/* [Setup guide](${canonicalGuidePath}) */}`],
  [
    "a fenced-code mention",
    `\`\`\`md\n[Setup guide](${canonicalGuidePath})\n\`\`\``,
  ],
  ["a longer route", `[Setup guide](${canonicalGuidePath}-old)`],
])("rejects %s as a canonical guide link", (_caseName, content) => {
  expect(() => expectCanonicalGuideLink(content)).toThrow();
});

test.each([
  ["the exact route", `[Setup guide](${canonicalGuidePath})`],
  [
    "a route with a query string",
    `[Setup guide](${canonicalGuidePath}?source=cli)`,
  ],
  ["a route with a fragment", `[Setup guide](${canonicalGuidePath}#runtime)`],
])("accepts %s as a canonical guide link", (_caseName, content) => {
  expectCanonicalGuideLink(content);
});

test.each([
  {
    canonicalGuide: "",
    entryPoints: ["NEXT_PUBLIC_CPK_INTELLIGENCE_API_KEY"],
    identifier: "NEXT_PUBLIC_CPK_INTELLIGENCE_API_KEY",
  },
  {
    canonicalGuide: "",
    entryPoints: ["CPK_INTELLIGENCE_API_KEY_BACKUP"],
    identifier: "CPK_INTELLIGENCE_API_KEY_BACKUP",
  },
  {
    canonicalGuide: "INTELLIGENCE_API_KEY",
    entryPoints: [],
    identifier: "INTELLIGENCE_API_KEY",
  },
])(
  "rejects the unsafe managed identifier $identifier",
  ({ canonicalGuide, entryPoints, identifier }) => {
    expect(findUnsafeManagedIdentifiers(canonicalGuide, entryPoints)).toEqual([
      identifier,
    ]);
  },
);

test("the Headless guide and React reference document run-based ordering", () => {
  const headlessThreads = readContent(headlessEntryPointPath);
  const sectionStart = headlessThreads.indexOf(
    "### List and manage threads with useThreads",
  );
  const sectionEnd = headlessThreads.indexOf(
    "### Switch between threads",
    sectionStart + 1,
  );

  expect(sectionStart).toBeGreaterThanOrEqual(0);
  expect(sectionEnd).toBeGreaterThan(sectionStart);

  const section = collapseWhitespace(
    headlessThreads.slice(sectionStart, sectionEnd),
  );
  const useThreadsReference = collapseWhitespace(
    readContent(useThreadsReferencePath),
  );
  const recencyOrder =
    "The `threads` array is sorted by recency: `lastRunAt` when present, falling back to `updatedAt`, then `createdAt` (most recent first).";

  for (const source of [section, useThreadsReference]) {
    expect.soft(source).toContain(recencyOrder);
    expect(source).not.toMatch(
      /(?:most recently updated first|sorted by `updatedAt` descending)/,
    );
  }
  expect(section).toContain(
    "Metadata-only updates such as rename or archive do not change the sort key for a thread that already has `lastRunAt`.",
  );
});

test("keeps shared Headless prerequisites provider-neutral", () => {
  const a2aHeadlessPage = readContent(
    "docs/integrations/a2a/headless-threads.mdx",
  );
  const sharedHeadlessGuide = readContent(headlessEntryPointPath);

  expect(a2aHeadlessPage).toContain(
    'import HeadlessThreads from "@/snippets/shared/threads/headless-threads.mdx";',
  );
  expect(sharedHeadlessGuide).toContain(
    "Credentials required by your configured agent provider or remote agent",
  );
  expect(sharedHeadlessGuide).not.toMatch(/^\s*- An OpenAI API key\s*$/m);
});

test("accepts the exact server-side managed key identifier", () => {
  expect(findUnsafeManagedIdentifiers("CPK_INTELLIGENCE_API_KEY", [])).toEqual(
    [],
  );
});

test("ignores prose that does not form an environment identifier", () => {
  expect(
    findUnsafeManagedIdentifiers(
      "Keep the Intelligence API key on the server.",
      [],
    ),
  ).toEqual([]);
});

test("does not promise an unused license key during hosted Quickstart signup", () => {
  const quickstart = readContent(
    "docs/integrations/built-in-agent/quickstart.mdx",
  );
  const hostedSignupLine = quickstart
    .split("\n")
    .find((line) =>
      line.includes('surface="docs_built_in_agent_quickstart_step1"'),
    );

  expect(hostedSignupLine).toContain(
    "With that account, you can later create or select a hosted project for persistent Threads and the Inspector.",
  );
  expect(hostedSignupLine).not.toMatch(/\blicense key\b/i);
});

test.each([
  {
    path: "docs/premium/managed-intelligence-platform.mdx",
    unqualifiedCreateClaim:
      "The CLI provisions a project-scoped key during `create` and `project select`",
  },
  {
    path: "snippets/shared/cli/cli.mdx",
    unqualifiedCreateClaim:
      "scaffolds the starter, and connects the app to a cloud-hosted Enterprise Intelligence project",
  },
])(
  "$path limits create-time managed provisioning to Threads-enabled starters",
  ({ path, unqualifiedCreateClaim }) => {
    const content = readContent(path);

    expect(content).toContain(
      "`create` scaffolds any supported starter. During `create`, only starters with Threads support continue through managed project selection and project-scoped key provisioning.",
    );
    expect(content).toContain(
      "[Connect an Existing App to Hosted Intelligence](/premium/existing-app-hosted-intelligence)",
    );
    expect(content).not.toContain(unqualifiedCreateClaim);
  },
);

test("distinguishes hosted onboarding from deployment-neutral Threads UI", () => {
  const managed = readContent("docs/premium/managed-intelligence-platform.mdx");
  const drawer = readContent(
    "snippets/shared/basics/copilot-threads-drawer.mdx",
  );
  const cli = readContent("snippets/shared/cli/cli.mdx");

  expect(managed).toContain(
    "For an existing app that you want to connect to the cloud-hosted service, run `npx copilotkit@latest project select`, then follow [Connect an Existing App to Hosted Intelligence](/premium/existing-app-hosted-intelligence).",
  );
  expect(managed).not.toContain(
    "For any existing app with a working Runtime v2 endpoint",
  );
  expect(drawer).toContain(
    "The React setup below is the same for cloud-hosted and self-hosted deployments; only the platform endpoint and Runtime credential change.",
  );
  expect(drawer).toContain(
    "For a cloud-hosted project, follow [Connect an Existing App to Hosted Intelligence](/premium/existing-app-hosted-intelligence) first.",
  );
  expect(drawer).not.toContain(
    "If your app already has a working Runtime v2 endpoint",
  );
  expect(cli).toContain(
    "For cloud-hosted Intelligence, it handles browser sign-in, project selection, project-scoped Runtime keys, and local project configuration.",
  );
  expect(cli).toContain(
    "Its import command can also target a self-hosted deployment through explicit destination flags, and its license commands support self-hosted or offline enterprise flows.",
  );
  expect(cli).toContain(
    "For an existing app that you want to connect to a cloud-hosted project, run `npx copilotkit@latest project select`, then follow [Connect an Existing App to Hosted Intelligence](/premium/existing-app-hosted-intelligence).",
  );
  expect(cli).not.toContain(
    "For any existing app with a working Runtime v2 endpoint",
  );
  expect(cli).not.toContain(
    "`project select` works in any app that already has a working Runtime v2 endpoint",
  );
});

const conditionalTelemetryClaim =
  "When telemetry is enabled and identity creation succeeds, the CLI may write `CPK_TELEMETRY_ID` for analytics attribution.";
const requiredKeyClaim =
  "`CPK_INTELLIGENCE_API_KEY` remains required for managed connectivity.";
const projectKeyOnlyClaim =
  "A selected project and its project-scoped key are a valid managed setup without `CPK_TELEMETRY_ID`.";

test("the CLI project config example shows every persisted binding field", () => {
  const projectConfigExample = findCliCodeFence(
    "json",
    ".copilotkit/project.json",
  );
  const serializedFields = Array.from(
    projectConfigExample.matchAll(/^\s*"([^"]+)"\s*:/gm),
    (match) => match[1],
  );

  expect(() => JSON.parse(projectConfigExample)).not.toThrow();
  expect(serializedFields).toEqual([
    "projectId",
    "projectSlug",
    "projectName",
    "clerkOrgId",
    "telemetryBindingId",
  ]);
});

test("the CLI .env example marks telemetry output as conditional", () => {
  const envExample = findCliCodeFence("bash", ".env");
  const envLines = envExample.split("\n").map((line) => line.trim());
  const keyIndex = envLines.indexOf("CPK_INTELLIGENCE_API_KEY=cpk_...");
  const telemetryIndex = envLines.indexOf("CPK_TELEMETRY_ID=...");

  expect(keyIndex).toBeGreaterThanOrEqual(0);
  expect(envLines[keyIndex - 2]).toBe(
    "# Your CopilotKit Enterprise Intelligence API Key",
  );
  expect(telemetryIndex).toBeGreaterThan(keyIndex);
  expect(envLines[telemetryIndex - 1]).toBe(
    "# Optional: written only when telemetry is enabled and identity creation succeeds",
  );
});

test("allows import and project reselection from any configured existing app", () => {
  const existingAppGuide = readCanonicalGuide();
  const cli = readContent("snippets/shared/cli/cli.mdx");
  const importStart = cli.indexOf(
    "## Import and synchronize historical conversations",
  );
  const authStart = cli.indexOf("## Auth commands", importStart);

  expect
    .soft(existingAppGuide)
    .toContain("Run these commands from your existing app:");
  expect
    .soft(existingAppGuide)
    .toContain(
      "The CLI records the project in `.copilotkit/project.json` and writes the project key to `.env`",
    );
  expect.soft(importStart).toBeGreaterThanOrEqual(0);
  expect.soft(authStart).toBeGreaterThan(importStart);

  const importSection = cli.slice(importStart, authStart).replace(/\s+/g, " ");

  expect.soft(importSection).not.toContain("created with the CLI");
  expect
    .soft(importSection)
    .toContain(
      "Use `import` from any existing app directory with Enterprise Intelligence enabled. The app does not need to have been created by the CLI.",
    );
  expect(importSection).toContain(
    "Any existing app can safely re-run `project select` before the dry run",
  );
  expect(importSection).toContain(
    "It does not by itself set the import destination.",
  );
  expect(importSection).toContain(
    "The importer does not load `.env` or `.copilotkit/project.json` automatically.",
  );
  expect(importSection).not.toContain(
    "The importer uses the selected project by default.",
  );
});

test.each([
  {
    path: "docs/premium/managed-intelligence-platform.mdx",
    sectionStart: "## API keys",
    sectionEnd: "## Threads and conversation history",
    staleClaims: [
      "It also writes the non-secret `CPK_TELEMETRY_ID` for analytics attribution.",
    ],
    preservedClaim:
      "Managed setup does not issue or write `COPILOTKIT_LICENSE_TOKEN`.",
  },
  {
    path: "snippets/shared/cli/cli.mdx",
    sectionStart: "### Use the generated environment",
    sectionEnd: "### Start development",
    staleClaims: [
      "The CLI writes the project-scoped runtime key and telemetry metadata to `.env`.",
      "The CLI writes `CPK_TELEMETRY_ID` for analytics attribution",
    ],
    preservedClaim: undefined,
  },
])(
  "$path makes telemetry identity output conditional in its managed setup section",
  ({ path, sectionStart, sectionEnd, staleClaims, preservedClaim }) => {
    const content = readContent(path);
    const startIndex = content.indexOf(sectionStart);
    const endIndex = content.indexOf(
      sectionEnd,
      startIndex + sectionStart.length,
    );

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(startIndex);

    const section = content.slice(startIndex, endIndex).replace(/\s+/g, " ");

    expect(section).toContain(conditionalTelemetryClaim);
    expect(section).toContain(requiredKeyClaim);
    expect(section).toContain(projectKeyOnlyClaim);
    for (const staleClaim of staleClaims) {
      expect(section).not.toContain(staleClaim);
    }
    if (preservedClaim !== undefined) {
      expect(section).toContain(preservedClaim);
    }
  },
);
