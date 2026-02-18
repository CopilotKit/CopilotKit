import Link from "next/link";
import Image from "next/image";
import { ReactNode } from "react";
import { findNeighbour } from "fumadocs-core/page-tree";
import { Page } from "fumadocs-core/source";
import { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import { ChevronRight } from "lucide-react";
import { ChevronLeft } from "lucide-react";

interface CustomPagerProps {
  tree: DocsLayoutProps["tree"];
  page: Page;
}

export function CustomPager({ tree, page }: CustomPagerProps): ReactNode {
  // Use fumadocs-core's built-in findNeighbour function for reliable prev/next detection
  const { previous, next: nextItem } = findNeighbour(tree, page.url);

  const prev = previous
    ? {
        url: previous.url,
        title: previous.name?.toString() || "",
      }
    : null;

  const next = nextItem
    ? {
        url: nextItem.url,
        title: nextItem.name?.toString() || "",
      }
    : null;

  if (!prev && !next) {
    return null;
  }

  return (
    <div className="box-content flex flex-row gap-0 justify-between items-center px-4 pb-12 lg:px-8 h-20 shrink-0">
      <div className={`flex h-full ${prev ? "w-full" : "w-max"}`}>
        {prev ? (
          <>
            <Link
              href={prev?.url}
              className="flex flex-col gap-1 justify-center px-3 lg:px-5 w-full h-[80px] rounded-2xl rounded-r-none border border-r-0 backdrop-blur-lg border-border "
              style={{ backgroundColor: "var(--sidebar)" }}
            >
              <div className="flex gap-2 justify-start items-center">
                <ChevronLeft className="size-4 shrink-0 text-fd-muted-foreground" />
                <span className="text-xs font-medium text-left font-spline">
                  PREV
                </span>
              </div>
              <span className="text-sm text-left line-clamp-2 lg:text-base">
                {prev.title}
              </span>
            </Link>
          </>
        ) : (
          <div
            className="w-11 h-full rounded-2xl rounded-r-none border border-r-0 backdrop-blur-lg border-border "
            style={{ backgroundColor: "var(--sidebar)" }}
          />
        )}

        <div className="flex shrink-0">
          <Image
            src="/images/redirects/slanted-end-border-dark.svg"
            alt="Slanted end border"
            width={34}
            height={80}
            className="hidden shrink-0 dark:inline-block"
          />
          <Image
            src="/images/redirects/slanted-end-border-light.svg"
            alt="Slanted end border"
            width={34}
            height={80}
            className="shrink-0 dark:hidden"
          />
        </div>
      </div>

      <div className={`flex -ml-3 h-full ${next ? "w-full" : "w-max"}`}>
        <div className="flex shrink-0">
          <Image
            src="/images/redirects/slanted-start-border-dark.svg"
            alt="Slanted start border"
            width={34}
            height={80}
            className="hidden shrink-0 dark:inline-block"
          />
          <Image
            src="/images/redirects/slanted-start-border-light.svg"
            alt="Slanted start border"
            width={34}
            height={80}
            className="shrink-0 dark:hidden"
          />
        </div>

        {next ? (
          <Link
            href={next.url}
            className="flex flex-col gap-1 justify-center px-3 lg:px-5 w-full h-[80px] rounded-2xl rounded-l-none border border-l-0 backdrop-blur-lg border-border "
            style={{ backgroundColor: "var(--sidebar)" }}
          >
            <div className="flex gap-2 justify-end items-center">
              <span className="text-xs font-medium text-right font-spline">
                NEXT
              </span>
              <ChevronRight className="size-4 shrink-0 text-fd-muted-foreground" />
            </div>
            <span className="text-sm text-right line-clamp-2 lg:text-base">
              {next.title}
            </span>
          </Link>
        ) : (
          <div
            className="w-11 h-full rounded-2xl rounded-l-none border border-l-0 backdrop-blur-lg border-border "
            style={{ backgroundColor: "var(--sidebar)" }}
          />
        )}
      </div>
    </div>
  );
}
