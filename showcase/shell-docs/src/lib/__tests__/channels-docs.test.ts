import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { inlineSnippets, loadDoc } from "../docs-render";
import { filterFrontendScopedBlocks } from "../toc";

function bodyFor(slug: string): string {
  const doc = loadDoc(slug);
  expect(doc, slug).not.toBeNull();
  return inlineSnippets(doc!.source);
}
function fencedTypeScriptBlocks(source: string): string[] {
  return Array.from(
    source.matchAll(/```(?:ts|tsx)[^\n]*\n([\s\S]*?)```/g),
    (match) => match[1],
  );
}

it("provider quickstarts use the shared SDK install recommendation", () => {
  const install = readFileSync(
    new URL(
      "../../content/snippets/shared/channels/install.mdx",
      import.meta.url,
    ),
    "utf8",
  );
  const command = install.match(/npm install --save-exact [^\n]+/)?.[0];
  expect(command).toBeDefined();
  for (const provider of ["slack", "teams"])
    expect(bodyFor("frontends/" + provider)).toContain(command);
});
it("keeps required environment reads self-contained in provider snippets", () => {
  for (const slug of [
    "channels/tools",
    "channels/interactive",
    "channels/threads-and-state",
  ] as const) {
    for (const frontend of ["slack", "teams"] as const) {
      const blocks = fencedTypeScriptBlocks(
        filterFrontendScopedBlocks(bodyFor(slug), frontend),
      ).filter((block) => block.includes("createChannel({"));

      expect(
        blocks.length,
        `${slug} ${frontend} createChannel blocks`,
      ).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block, `${slug} ${frontend} required helper`).toContain(
          "function required(name: string): string",
        );
        expect(block).toContain('required("CHANNEL_CODE")');
      }
    }
  }
});
it("resumes approvals even when the interaction message cannot be updated", () => {
  for (const slug of ["channels/interactive"] as const) {
    const source = bodyFor(slug);
    const updates = Array.from(source.matchAll(/await thread\.update\(/g));
    const resumes = Array.from(
      source.matchAll(/await thread\.resume\(value\);/g),
    );

    expect(updates.length, `${slug} update examples`).toBeGreaterThan(0);
    expect(resumes.length, `${slug} matching resume examples`).toBe(
      updates.length,
    );
    expect(source, `${slug} updateable-ref guidance`).toMatch(
      /`message\.ref\.id`[\s\S]{0,240}(?:non-empty|interaction carries)/i,
    );

    for (const update of updates) {
      const updateIndex = update.index;
      const guardIndex = source.lastIndexOf(
        "if (message.ref.id) {",
        updateIndex,
      );
      const previousResumeIndex = source.lastIndexOf(
        "await thread.resume(value);",
        updateIndex,
      );
      const catchIndex = source.indexOf("} catch {", updateIndex);
      const resumeIndex = source.indexOf(
        "await thread.resume(value);",
        updateIndex,
      );

      expect(guardIndex, `${slug} guards message update`).toBeGreaterThan(
        previousResumeIndex,
      );
      expect(
        catchIndex,
        `${slug} treats update as best-effort`,
      ).toBeGreaterThan(updateIndex);
      expect(catchIndex, `${slug} catches update before resume`).toBeLessThan(
        resumeIndex,
      );
    }
  }
});
