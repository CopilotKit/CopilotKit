import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("../page.tsx", import.meta.url),
  "utf8",
);

describe("FrameworkRootShell layout", () => {
  it("does not add top padding above framework landing content", () => {
    const shellSource = pageSource.match(
      /function FrameworkRootShell[\s\S]*?<\/ShellDocsLayout>/,
    )?.[0];

    expect(shellSource).toContain(
      'className="docs-inner-content shell-docs-framework-page max-w-[900px] mx-auto px-4 md:px-6 pt-0 pb-6"',
    );
    expect(shellSource).not.toContain("pt-2 pb-6 md:pt-3 xl:pt-4");
  });

  it("parses frontend routes before resolving frontend content slugs", () => {
    expect(pageSource).toContain("parseFrontendRoutePath");
    expect(pageSource).toContain("activeBackendFramework");
    expect(pageSource).toContain("frameworkOverride={activeBackendFramework}");
  });

  it("redirects retired frontend URL shapes instead of rendering them", () => {
    expect(pageSource).toContain('if (framework === "frontends")');
    expect(pageSource).toContain("legacyFrontendPathRedirect(");
    expect(pageSource).toContain(
      "const frontendRedirect = legacyFrontendPathRedirect(",
    );
  });

  it("canonicalizes React guidance routes to the React root", () => {
    expect(pageSource).toContain(
      'return frontendPathForBackend("react", slugPath);',
    );
  });

  it("renders backend docs when a frontend route includes a backend slug", () => {
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

  it("keeps frontend root pages available under frontend/backend routes", () => {
    const frontendRootIndex = pageSource.indexOf(
      "if (!activeFrontendSlugPath) {\n      return (\n        <FrontendQuickstartDocsPage",
    );
    const backendScopingIndex = pageSource.indexOf(
      "if (activeBackendFramework) {\n      scopedFramework = activeBackendFramework",
    );

    expect(frontendRootIndex).toBeGreaterThan(-1);
    expect(backendScopingIndex).toBeGreaterThan(-1);
    expect(frontendRootIndex).toBeLessThan(backendScopingIndex);
  });

  it("keeps frontend guidance pages available under frontend/backend routes", () => {
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

  it("uses backend metadata for frontend routes that include a backend slug", () => {
    expect(pageSource).toContain("frameworkMetadata(");
    expect(pageSource).toMatch(
      /frameworkMetadata\(\s*activeBackendFramework,\s*activeFrontendSlugPath/s,
    );
    expect(pageSource).toContain("scopedRoutePath(");
  });
});
