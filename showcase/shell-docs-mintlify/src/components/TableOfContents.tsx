import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@mintlify/components";

export interface TocHeading {
  depth: number;
  slug: string;
  text: string;
}

export default function TableOfContents({
  headings,
}: {
  headings: TocHeading[];
}) {
  const tocHeadings = useMemo(
    () => headings.filter((h) => h.depth >= 2 && h.depth <= 3),
    [headings],
  );
  const [activeSlug, setActiveSlug] = useState("");

  const handleScroll = useCallback(() => {
    const headingElements = tocHeadings
      .map((h) => document.getElementById(h.slug))
      .filter(Boolean) as HTMLElement[];

    if (headingElements.length === 0) return;

    if (
      window.innerHeight + window.scrollY >=
      document.body.scrollHeight - 10
    ) {
      setActiveSlug(headingElements[headingElements.length - 1].id);
      return;
    }

    let active = "";
    for (const heading of headingElements) {
      if (heading.getBoundingClientRect().top <= 150) active = heading.id;
      else break;
    }
    setActiveSlug(active);
  }, [tocHeadings]);

  useEffect(() => {
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  if (tocHeadings.length === 0) return null;

  return (
    <>
      <style>{`
        .toc-wrapper {
          display: none;
        }
        @container (min-width: 1280px) {
          .toc-wrapper {
            display: flex;
          }
        }
      `}</style>
      <div className="toc-wrapper flex-col sticky top-16 h-[calc(100vh-4rem)] w-80 shrink-0 pl-10">
        <nav className="overflow-y-auto text-sm leading-6 pt-2 pb-8">
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "instant" })}
            className="font-medium text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <LinesIcon />
            <span>On this page</span>
          </button>
          <ul className="space-y-0.5">
            {tocHeadings.map((heading) => {
              const isActive = activeSlug === heading.slug;

              return (
                <li key={heading.slug}>
                  <a
                    href={`#${heading.slug}`}
                    className={cn(
                      "block py-1 wrap-break-word transition-colors",
                      heading.depth > 2 ? "pl-4" : "pl-0",
                      isActive
                        ? "font-medium text-(--primary)"
                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100",
                    )}
                  >
                    {heading.text}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}

function LinesIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      xmlns="http://www.w3.org/2000/svg"
      className="h-3 w-3"
    >
      <path
        d="M2.44434 12.6665H13.5554"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.44434 3.3335H13.5554"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.44434 8H7.33323"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
