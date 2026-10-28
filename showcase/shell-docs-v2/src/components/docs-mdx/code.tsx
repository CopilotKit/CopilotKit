import type { ReactNode } from "react";
import type { ShikiTransformer } from "shiki";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { STAGE_WINDOW, Stage, isCommandLang } from "@/components/brand/stage";
import { brandDark, brandLight } from "@/proto/code-theme";

/**
 * Code a component renders from data (a showcase snippet, a bundled file),
 * highlighted on the server and set the way MDX code fences are: Fumadocs'
 * code block as a white window on the demo stage, commands on the compact
 * stage.
 */
export async function DocsCode({
  code,
  lang = "plaintext",
  title,
  highlightLines,
  className = "my-6",
}: {
  code: string;
  lang?: string;
  /** The file-path caption in the block's bar. */
  title?: string;
  /** 1-based line numbers to emphasize. */
  highlightLines?: ReadonlySet<number>;
  className?: string;
}) {
  const transformers: ShikiTransformer[] = [];
  if (highlightLines?.size) {
    transformers.push({
      name: "docs-mdx:highlight-lines",
      line(node, line) {
        if (highlightLines.has(line)) this.addClassToHast(node, "highlighted");
      },
    });
  }
  // Called, not rendered, so a failed highlight can be caught here.
  const block = (language: string) =>
    ServerCodeBlock({
      code: code.replace(/\n$/, ""),
      lang: language,
      themes: { light: brandLight, dark: brandDark },
      transformers,
      codeblock: { title, className: STAGE_WINDOW },
    });
  let rendered: ReactNode;
  try {
    rendered = await block(lang);
  } catch {
    // A language Shiki doesn't bundle reads as plain text, not an error.
    rendered = await block("plaintext");
  }
  return (
    <Stage compact={isCommandLang(lang)} className={className}>
      {rendered}
    </Stage>
  );
}
