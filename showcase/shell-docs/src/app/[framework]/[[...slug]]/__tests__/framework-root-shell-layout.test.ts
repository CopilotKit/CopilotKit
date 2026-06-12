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
      'className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-0 pb-6"',
    );
    expect(shellSource).not.toContain("pt-2 pb-6 md:pt-3 xl:pt-4");
  });
});
