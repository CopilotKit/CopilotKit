import { CodeBlock } from "@mintlify/components";

interface MintCodeBlockProps {
  /** Raw source code to render inside the code block. */
  code: string;
  /** Language hint, e.g. `tsx`, `bash`. */
  language?: string;
  /** Filename shown in the code-block header. */
  filename?: string;
  /** Optional Lucide-style icon name shown next to the filename. */
  icon?: string;
  /** Show line numbers in the gutter. */
  lines?: boolean;
  /** Soft-wrap long lines instead of horizontal scrolling. */
  wrap?: boolean;
  /** Render an expand/collapse footer for long blocks. */
  expandable?: boolean;
  /** JSON-stringified array of 1-indexed line numbers to highlight, e.g. `"[1,3,4]"`. */
  highlight?: string;
  /** JSON-stringified array of 1-indexed line numbers to focus, e.g. `"[1,2]"`. */
  focus?: string;
}

/**
 * Thin wrapper around Mintlify's `<CodeBlock>` that lets us pass the source as
 * a string `code` prop instead of as JSX children. We do this so the
 * `remark-mintlify-code-block` plugin can transform every fenced code block
 * into `<MintCodeBlock code="..." />` (a self-closing JSX element with simple
 * string attributes) — much easier than constructing an MDX flow expression
 * with an estree program for the children.
 *
 * `<CodeBlock>` itself runs Shiki client-side (re-highlighting from the source
 * string) and ships its own header, copy button, Ask AI button, and CSS for
 * line highlights / focus / diff annotations.
 */
export default function MintCodeBlock({ code, ...rest }: MintCodeBlockProps) {
  return (
    <CodeBlock
      {...rest}
      codeBlockThemeObject={{
        theme: { light: "catppuccin-latte", dark: "tokyo-night" },
      }}
    >
      {code}
    </CodeBlock>
  );
}
