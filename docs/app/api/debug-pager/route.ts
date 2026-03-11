import { source } from "@/app/source";
import { findNeighbour } from "fumadocs-core/page-tree";
import { patchPageTree } from "@/lib/patch-pagetree";
import { NextResponse } from "next/server";

export async function GET() {
  const allPages = source.getPages();
  const patchedTree = patchPageTree(source.pageTree);

  const pagesWithNoNeighbors: Array<{
    url: string;
    title: string;
    slugs: string[];
  }> = [];

  const pagesWithOneNeighbor: Array<{
    url: string;
    title: string;
    slugs: string[];
    hasPrev: boolean;
    hasNext: boolean;
    prevUrl?: string;
    nextUrl?: string;
  }> = [];

  // Check each page for neighbors
  for (const page of allPages) {
    const { previous, next } = findNeighbour(patchedTree, page.url);

    const hasPrev = !!previous;
    const hasNext = !!next;

    if (!hasPrev && !hasNext) {
      pagesWithNoNeighbors.push({
        url: page.url,
        title: page.data.title || "Untitled",
        slugs: Array.isArray(page.slugs) ? page.slugs : [],
      });
    } else if ((hasPrev && !hasNext) || (!hasPrev && hasNext)) {
      pagesWithOneNeighbor.push({
        url: page.url,
        title: page.data.title || "Untitled",
        slugs: Array.isArray(page.slugs) ? page.slugs : [],
        hasPrev,
        hasNext,
        prevUrl: previous?.url,
        nextUrl: next?.url,
      });
    }
  }

  return NextResponse.json(
    {
      summary: {
        totalPages: allPages.length,
        pagesWithNoNeighbors: pagesWithNoNeighbors.length,
        pagesWithOneNeighbor: pagesWithOneNeighbor.length,
        pagesWithBothNeighbors:
          allPages.length -
          pagesWithNoNeighbors.length -
          pagesWithOneNeighbor.length,
      },
      pagesWithNoNeighbors,
      pagesWithOneNeighbor: pagesWithOneNeighbor.slice(0, 20), // Limit to first 20 for readability
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}
