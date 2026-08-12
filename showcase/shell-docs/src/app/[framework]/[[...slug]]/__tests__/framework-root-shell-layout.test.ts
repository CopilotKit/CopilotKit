import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const pageSource = readFileSync(
  new URL("../page.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(startMarker: string, endMarker: string): string {
  const startIndex = pageSource.indexOf(startMarker);
  const endIndex = pageSource.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0) return "";
  return pageSource.slice(startIndex, endIndex);
}

test("does not add top padding above framework landing content", () => {
  const shellSource = pageSource.match(
    /function FrameworkRootShell[\s\S]*?<\/ShellDocsLayout>/,
  )?.[0];

  expect(shellSource).toContain(
    'className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-0 pb-6"',
  );
  expect(shellSource).not.toContain("pt-2 pb-6 md:pt-3 xl:pt-4");
});

test("parses frontend routes before resolving frontend content slugs", () => {
  expect(pageSource).toContain("parseFrontendRoutePath");
  expect(pageSource).toContain("activeBackendFramework");
  expect(pageSource).toContain("frameworkOverride={activeBackendFramework}");
});

test("redirects retired frontend URL shapes instead of rendering them", () => {
  expect(pageSource).toContain('if (framework === "frontends")');
  expect(pageSource).toContain("legacyFrontendPathRedirect(");
  expect(pageSource).toContain(
    "const frontendRedirect = legacyFrontendPathRedirect(",
  );
});

test("canonicalizes React guidance routes to the React root", () => {
  expect(pageSource).toContain(
    'return frontendPathForBackend("react", slugPath);',
  );
});

test("renders backend docs for every frontend route with a backend slug", () => {
  expect(pageSource).toContain("resolveAngularDoc(");
  expect(pageSource).toContain("getAngularDocsNavTree(");
  expect(pageSource).toContain("if (activeBackendFramework) {");
  expect(pageSource).toContain("scopedFramework = activeBackendFramework");
  expect(pageSource).toContain("scopedSlugHrefPrefix = frontendRoutePath(");
  expect(pageSource).toContain("frameworkOverride={scopedFramework}");
  expect(pageSource).toContain(
    "slugHrefPrefix={scopedSlugHrefPrefix ?? `/${scopedFramework}`}",
  );
  expect(pageSource).toContain(
    "preferIndexMdx={Boolean(scopedSlugHrefPrefix)}",
  );
});

test("keeps frontend root pages available under frontend/backend routes", () => {
  const frontendRootIndex = pageSource.indexOf(
    "if (!activeFrontendSlugPath) {",
  );
  const backendScopingIndex = pageSource.indexOf(
    "if (activeBackendFramework) {\n      scopedFramework = activeBackendFramework",
  );

  expect(frontendRootIndex).toBeGreaterThan(-1);
  expect(backendScopingIndex).toBeGreaterThan(-1);
  expect(frontendRootIndex).toBeLessThan(backendScopingIndex);
  expect(pageSource).toContain(
    '(framework === "angular" || framework === "vue") &&\n        activeBackendFramework',
  );
  expect(pageSource).toContain("<FrameworkRootPage");
  expect(pageSource).toContain("<FrontendQuickstartDocsPage");
});

test("keeps generated backend overviews on the generated overview contract", () => {
  expect(pageSource).toContain("preferIndexMdx &&");
  expect(pageSource).toContain('docsMode !== "generated"');
  expect(pageSource).toContain("indexDoc");
  expect(pageSource).toContain(
    "buildFrontendBackendOverview(frontendOverride, overview, framework)",
  );
  expect(pageSource).toContain('frontendOverride !== "vue"');
  expect(pageSource).toContain(
    'docsMode === "generated" || frontendOverride === "vue"',
  );
});

test("keeps frontend guidance pages available under frontend/backend routes", () => {
  const guidanceIndex = pageSource.indexOf(
    "if (isFrontendGuidanceSlug(activeFrontendSlugPath))",
  );
  const backendScopingIndex = pageSource.indexOf(
    "if (activeBackendFramework) {\n      scopedFramework = activeBackendFramework",
  );

  expect(guidanceIndex).toBeGreaterThan(-1);
  expect(backendScopingIndex).toBeGreaterThan(-1);
  expect(guidanceIndex).toBeLessThan(backendScopingIndex);
  expect(pageSource).toContain("<FrontendGuidanceDocsPage");
});

test("rejects hidden backend metadata before frontend aliases", () => {
  const metadataSource = sourceBetween(
    "export async function generateMetadata",
    "export async function generateStaticParams",
  );
  const parsedBackendIndex = metadataSource.indexOf(
    "const activeBackendFramework =",
  );
  const hiddenBackendIndex = metadataSource.indexOf(
    'getDocsMode(activeBackendFramework) === "hidden"',
  );
  const guidanceIndex = metadataSource.indexOf(
    "if (isFrontendGuidanceSlug(activeFrontendSlugPath))",
  );
  const rootIndex = metadataSource.indexOf(
    "isFrontendRootSlug(activeFrontendSlugPath)",
  );
  const channelGuideIndex = metadataSource.indexOf(
    "const channelGuideRoute = resolveChannelGuideRoute(",
  );

  expect(hiddenBackendIndex).toBeGreaterThan(parsedBackendIndex);
  expect(guidanceIndex).toBeGreaterThan(hiddenBackendIndex);
  expect(rootIndex).toBeGreaterThan(hiddenBackendIndex);
  expect(channelGuideIndex).toBeGreaterThan(hiddenBackendIndex);
  expect(metadataSource.slice(hiddenBackendIndex, guidanceIndex)).toContain(
    "notFound();",
  );
});

test("routes mapped channel guides before Angular and generic backend docs", () => {
  const routeSource = sourceBetween(
    "export default async function FrameworkScopedDocsPage",
    "function FrontendQuickstartDocsPage",
  );
  const hiddenBackendIndex = routeSource.indexOf(
    'getDocsMode(activeBackendFramework) === "hidden"',
  );
  const rootIndex = routeSource.indexOf("if (!activeFrontendSlugPath) {");
  const quickstartIndex = routeSource.indexOf(
    'if (activeFrontendSlugPath === "quickstart")',
  );
  const guidanceIndex = routeSource.indexOf(
    "if (isFrontendGuidanceSlug(activeFrontendSlugPath))",
  );
  const channelGuideIndex = routeSource.indexOf(
    "const channelGuideRoute = resolveChannelGuideRoute(",
  );
  const angularIndex = routeSource.indexOf(
    'if (framework === "angular") {',
    channelGuideIndex,
  );
  const backendScopingIndex = routeSource.indexOf(
    "if (activeBackendFramework) {\n      scopedFramework = activeBackendFramework",
  );

  expect(hiddenBackendIndex).toBeGreaterThan(-1);
  expect(rootIndex).toBeGreaterThan(hiddenBackendIndex);
  expect(quickstartIndex).toBeGreaterThan(rootIndex);
  expect(guidanceIndex).toBeGreaterThan(quickstartIndex);
  expect(channelGuideIndex).toBeGreaterThan(guidanceIndex);
  expect(angularIndex).toBeGreaterThan(channelGuideIndex);
  expect(backendScopingIndex).toBeGreaterThan(angularIndex);
  expect(routeSource).toContain("<ChannelGuideDocsPage");
});

test("threads mapped channel guides through the channel docs shell", () => {
  const channelGuidePageSource = sourceBetween(
    "function ChannelGuideDocsPage",
    "function FrontendQuickstartDocsPage",
  );

  expect(channelGuidePageSource).toContain(
    "if (!loadDoc(contentSlugPath)) notFound();",
  );
  expect(channelGuidePageSource).toContain("slugPath={slugPath}");
  expect(channelGuidePageSource).toContain("contentSlugPath={contentSlugPath}");
  expect(channelGuidePageSource).toContain(
    'slugHrefPrefix={frontendRoutePath(frontend, "", activeBackendFramework)}',
  );
  expect(channelGuidePageSource).toContain(
    "frameworkOverride={activeBackendFramework ?? ROOT_FRAMEWORK}",
  );
  expect(channelGuidePageSource).toContain("frontendOverride={frontend}");
  expect(channelGuidePageSource).toContain(
    "navTree={getFrontendQuickstartNavTree(frontend)}",
  );
  expect(channelGuidePageSource).toContain(
    "sidebarBannerSlot={<FrontendSidebarBanner frontend={frontend} />}",
  );
  expect(channelGuidePageSource).toContain("frontend: ChannelFrontend;");
});

test("resolves channel guide metadata before framework metadata", () => {
  const metadataSource = sourceBetween(
    "export async function generateMetadata",
    "export async function generateStaticParams",
  );
  const channelGuideIndex = metadataSource.indexOf(
    "const channelGuideRoute = resolveChannelGuideRoute(",
  );
  const angularIndex = metadataSource.indexOf(
    'if (framework === "angular" && activeFrontendSlugPath)',
  );
  const frameworkMetadataIndex = metadataSource.indexOf(
    "return frameworkMetadata(",
  );
  const channelGuideMetadataSource = metadataSource.slice(
    channelGuideIndex,
    angularIndex,
  );

  expect(channelGuideIndex).toBeGreaterThan(-1);
  expect(angularIndex).toBeGreaterThan(channelGuideIndex);
  expect(frameworkMetadataIndex).toBeGreaterThan(channelGuideIndex);
  expect(channelGuideMetadataSource).toContain(
    "const doc = loadDoc(channelGuideRoute.sourceSlug);",
  );
  expect(channelGuideMetadataSource).toContain(
    "const canonicalPath = channelGuideRoute.canonicalPath;",
  );
  expect(channelGuideMetadataSource).toContain("return buildDocMetadata({");
  expect(channelGuideMetadataSource).toContain("canonicalPath,");
  expect(channelGuideMetadataSource).toContain(
    "ogPath: `/og${canonicalPath}/og.png`,",
  );
  expect(channelGuideMetadataSource).toMatch(
    /channelGuideRoute\.frontend === "teams"\s*\?\s*"Microsoft Teams"/,
  );
  expect(channelGuideMetadataSource).toContain(
    "getIntegration(channelGuideRoute.framework)?.name",
  );
});

test("uses backend metadata for frontend routes that include a backend slug", () => {
  expect(pageSource).toMatch(
    /framework === "angular" && activeFrontendSlugPath[\s\S]*resolveAngularDoc\(/,
  );
  expect(pageSource).toContain("frameworkMetadata(");
  expect(pageSource).toMatch(
    /frameworkMetadata\(\s*activeBackendFramework,\s*activeFrontendSlugPath/s,
  );
  expect(pageSource).toContain("scopedRoutePath(");
});
