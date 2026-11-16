"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/spacious/page";

// A page that throws while rendering, inside the docs layout, as shell-docs'
// `[[...slug]]/error.tsx` did.

export default function DocsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  useEffect(() => {
    // The whole Error, so the stack trace reaches the browser console.
    console.error(
      `[docs] Page render error${pathname ? ` on ${pathname}` : ""}:`,
      error,
    );
  }, [error, pathname]);

  return (
    <DocsPage toc={[]}>
      <DocsTitle className="text-[2.25rem] leading-[1.1] font-medium md:text-[2.5rem] tracking-[-0.03em] text-balance">
        Something went wrong
      </DocsTitle>
      <DocsDescription className="mb-0">
        We hit an error rendering this page. Please refresh, and if it keeps
        happening, report it with the ID below.
      </DocsDescription>
      <DocsBody>
        {error.digest ? (
          <p>
            Error ID: <code>{error.digest}</code>
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="not-prose inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors hover:bg-accent"
        >
          Try again
        </button>
      </DocsBody>
    </DocsPage>
  );
}
