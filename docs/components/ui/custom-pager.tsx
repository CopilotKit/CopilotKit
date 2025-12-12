import Link from 'next/link';
import { ReactNode } from 'react';
import type { PageTree } from 'fumadocs-core/server';
import { Page } from 'fumadocs-core/source';
import { ChevronRight } from 'lucide-react';
import { ChevronLeft } from 'lucide-react';

interface CustomPagerProps {
  tree: PageTree.Root;
  page: Page;
}

function cleanTree(tree: PageTree.Node[]): PageTree.Node[] {
  return tree.flatMap((node: PageTree.Node) => {
    if (node.type === 'folder') {
      return [node, ...cleanTree(node.children as PageTree.Node[])];
    }
    if (node.type === 'page') {
      return [node];
    }
    return [];
  });
}

function getIndex(tree: PageTree.Node[], page: Page): number {
  console.log(page, tree);

  return tree.findIndex(node => {
    if (node.type === 'folder') {
      return (node as PageTree.Folder).index?.$id === page.path;
    }
    if (node.type === 'page') {
      return (node as PageTree.Item).$id === page.path;
    }
    return false;
  });
}

function getPrev(tree: PageTree.Node[], pageIndex: number): { url: string; title: string } | null {
  if (pageIndex === 0) return null;

  const prevItem = tree[pageIndex - 1];

  if (prevItem.type === 'folder') {
    return {
      url: (prevItem as PageTree.Folder).index?.url as string,
      title: (prevItem as PageTree.Folder).index?.name?.toString() as string,
    };
  }
  return {
    url: (prevItem as PageTree.Item).url as string,
    title: (prevItem as PageTree.Item).name?.toString() as string,
  };
}

function getNext(tree: PageTree.Node[], pageIndex: number): { url: string; title: string } | null {
  if (pageIndex === tree.length - 1) return null;
  const nextItem = tree[pageIndex + 1];

  if (nextItem.type === 'folder') {
    return {
      url: (nextItem as PageTree.Folder).index?.url as string,
      title: (nextItem as PageTree.Folder).index?.name?.toString() as string,
    };
  }
  return {
    url: (nextItem as PageTree.Item).url as string,
    title: (nextItem as PageTree.Item).name?.toString() as string,
  };
}

export function CustomPager({ tree, page }: CustomPagerProps): ReactNode {
  const cleanedTree = cleanTree(tree.children);
  const pageIndex = getIndex(cleanedTree, page);
  const prev = getPrev(cleanedTree, pageIndex);
  const next = getNext(cleanedTree, pageIndex);

  return (
    <div className='flex justify-between gap-4 pb-8 mt-12 mx-10'>
      {prev ? (
        <Link
          href={prev?.url}
          className='flex px-3 py-5 gap-2 justify-end flex-col h-20 rounded-2xl border backdrop-blur-lg border-border bg-glass-background w-full'>
          <div className='flex items-center justify-start gap-2'>
            <ChevronLeft className='size-4 shrink-0 text-fd-muted-foreground' />
            <span className='text-left text-xs font-medium font-spline'>PREV</span>
          </div>
          <span className='text-left'>{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}

      {next ? (
        <Link
          href={next.url}
          className='flex px-3 py-5 gap-2 justify-end flex-col h-20 rounded-2xl border backdrop-blur-lg border-border bg-glass-background w-full'>
          <div className='flex items-center justify-end gap-2'>
            <span className='text-right text-xs font-medium font-spline'>NEXT</span>
            <ChevronRight className='size-4 shrink-0 text-fd-muted-foreground' />
          </div>
          <span className='text-right'>{next.title}</span>
        </Link>
      ) : null}
    </div>
  );
}
