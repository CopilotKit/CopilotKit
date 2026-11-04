"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { TOCProvider } from "fumadocs-ui/layouts/spacious/page/slots/toc";

type TOCItems = ComponentProps<typeof TOCProvider>["toc"];

/** The urls of the TOC items whose heading is on the page right now. */
function presentUrls(toc: TOCItems) {
  return toc
    .filter((item) => {
      const id = decodeURIComponent(item.url.replace(/^#/, ""));
      return document.getElementById(id) !== null;
    })
    .map((item) => item.url)
    .join("\n");
}

/**
 * Until hydration, CSS does the same job: an entry hides while its heading
 * isn't on the page, so the server-rendered TOC never shows another path's
 * headings. Prose links to those anchors are left alone.
 */
function hideMissingCss(toc: TOCItems) {
  return toc
    .map((item) => {
      const id = JSON.stringify(decodeURIComponent(item.url.replace(/^#/, "")));
      const href = JSON.stringify(item.url);
      return `body:not(:has([id=${id}])) a[href=${href}]:not(#nd-page a){display:none}`;
    })
    .join("");
}

/**
 * Fumadocs' TOC provider, keeping only headings the page shows. A page's TOC
 * is compiled from all of its MDX, including every path of a
 * `<TailoredContent>` picker; only the picked path renders, so the TOC follows
 * it. The server render keeps the full, static TOC.
 */
export function VisibleTOCProvider({
  toc,
  ...props
}: ComponentProps<typeof TOCProvider>) {
  const [present, setPresent] = useState<string | null>(null);

  useEffect(() => {
    const page = document.getElementById("nd-page");
    if (!page) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      setPresent(presentUrls(toc));
    };
    read();
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(read);
    });
    observer.observe(page, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [toc]);

  const visible = useMemo(() => {
    if (present === null) return toc;
    const urls = new Set(present.split("\n"));
    return toc.filter((item) => urls.has(item.url));
  }, [toc, present]);

  return (
    <>
      {present === null ? <style>{hideMissingCss(toc)}</style> : null}
      <TOCProvider toc={visible} {...props} />
    </>
  );
}
