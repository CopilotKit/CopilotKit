"use client";

import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
// Type-only import: erased at build time, so `streamdown` is NOT pulled into the
// static graph. The dynamic import()s in the lazy() factory below are the sole
// runtime references, so streamdown — together with the code/math/mermaid
// plugins and all their machinery — loads as a separate chunk, and builds that
// never render chat ship 0 bytes of it.
import type { Streamdown } from "streamdown";

export type LazyStreamdownProps = ComponentProps<typeof Streamdown>;

// streamdown and @streamdown/{code,math,mermaid} are ESM-only. They are loaded
// here via dynamic import() (not a static import) for two reasons:
//  1. Code-splitting — they land in a lazily-loaded chunk, kept out of the
//     initial bundle.
//  2. CJS safety — the bundler preserves dynamic import() as a native import()
//     in the generated CJS build, whereas a static import is emitted as
//     require(), which throws ERR_PACKAGE_PATH_NOT_EXPORTED for these ESM-only
//     packages when the chunk is evaluated in a Node CJS runtime.
const StreamdownLazy = lazy(async () => {
  const [{ Streamdown }, { code }, { createMathPlugin }, { mermaid }] =
    await Promise.all([
      import("streamdown"),
      import("@streamdown/code"),
      import("@streamdown/math"),
      import("@streamdown/mermaid"),
    ]);

  // @streamdown/math's default `math` plugin disables single-`$` inline math;
  // streamdown v1 (remark-math default) rendered it, so enable
  // singleDollarTextMath to preserve v1 behavior. (`$$…$$`/`\(…\)` work either way.)
  const math = createMathPlugin({ singleDollarTextMath: true });

  // streamdown v2 ships code/math/mermaid as opt-in plugins; we enable all three
  // here so syntax highlighting (Shiki, CDN-loaded grammars), math (KaTeX), and
  // diagrams (Mermaid, rendered on demand) keep working as they did under
  // streamdown v1 — but their heavy machinery stays in this lazy chunk.
  return {
    default: function StreamdownWithPlugins({
      plugins,
      ...props
    }: LazyStreamdownProps) {
      return (
        <Streamdown plugins={{ code, math, mermaid, ...plugins }} {...props} />
      );
    },
  };
});

/**
 * Lazily-loaded {@link Streamdown}. While the chunk loads, the already-streamed
 * text is shown as plain preformatted content so streaming stays visible with no
 * layout jank; once loaded, the rendered markdown replaces it.
 */
export function LazyStreamdown({ children, ...props }: LazyStreamdownProps) {
  const fallback =
    typeof children === "string" ? (
      <pre className="cpk:whitespace-pre-wrap cpk:break-words cpk:font-sans cpk:m-0">
        {children}
      </pre>
    ) : null;

  return (
    <Suspense fallback={fallback}>
      <StreamdownLazy {...props}>{children}</StreamdownLazy>
    </Suspense>
  );
}

LazyStreamdown.displayName = "LazyStreamdown";
