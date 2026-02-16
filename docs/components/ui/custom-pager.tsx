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
    <div className="box-content flex h-20 shrink-0 flex-row items-center justify-between gap-0 px-4 pb-12 lg:px-8">
      <div className={`flex h-full ${prev ? "w-full" : "w-max"}`}>
        {prev ? (
          <>
            <Link
              href={prev?.url}
              className="border-border flex h-[80px] w-full flex-col justify-center gap-1 rounded-2xl rounded-r-none border border-r-0 px-3 backdrop-blur-lg lg:px-5"
              style={{ backgroundColor: "var(--sidebar)" }}
            >
              <div className="flex items-center justify-start gap-2">
                <ChevronLeft className="text-fd-muted-foreground size-4 shrink-0" />
                <span className="font-spline text-left text-xs font-medium">
                  PREV
                </span>
              </div>
              <span className="line-clamp-2 text-left text-sm lg:text-base">
                {prev.title}
              </span>
            </Link>
          </>
        ) : (
          <div
            className="border-border h-full w-11 rounded-2xl rounded-r-none border border-r-0 backdrop-blur-lg"
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

      <div className={`-ml-3 flex h-full ${next ? "w-full" : "w-max"}`}>
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
            className="border-border flex h-[80px] w-full flex-col justify-center gap-1 rounded-2xl rounded-l-none border border-l-0 px-3 backdrop-blur-lg lg:px-5"
            style={{ backgroundColor: "var(--sidebar)" }}
          >
            <div className="flex items-center justify-end gap-2">
              <span className="font-spline text-right text-xs font-medium">
                NEXT
              </span>
              <ChevronRight className="text-fd-muted-foreground size-4 shrink-0" />
            </div>
            <span className="line-clamp-2 text-right text-sm lg:text-base">
              {next.title}
            </span>
          </Link>
        ) : (
          <div
            className="border-border h-full w-11 rounded-2xl rounded-l-none border border-l-0 backdrop-blur-lg"
            style={{ backgroundColor: "var(--sidebar)" }}
          />
        )}
      </div>
    </div>
  );
}
