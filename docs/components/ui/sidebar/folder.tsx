'use client';

import { useCallback } from 'react';
import { DocsLayoutProps } from 'fumadocs-ui/layouts/docs';
import { usePathname, useRouter } from 'next/navigation';
import Page from './page';
import ChevronDownIcon from '../icons/chevron';
import { cn } from '@/lib/utils';
import Separator from './separator';
import { useOpenedFolders } from '@/lib/hooks/use-opened-folders';

type Node = DocsLayoutProps['tree']['children'][number] & {
  url: string;
  $id?: string;
};

interface FolderProps {
  node: Node & { index?: { url: string; $id?: string } };
  onNavigate?: () => void;
}

/**
 * Normalizes a URL by removing trailing slashes
 */
function normalizeUrl(url: string): string {
  if (!url) return '';
  return url === '/' ? '/' : url.replace(/\/$/, '');
}

/**
 * Checks if a folder's index URL matches the current pathname.
 * Handles:
 * - Index page normalization (e.g., /langgraph matches /langgraph/index)
 * - Rewrite matches (e.g., /langgraph matches /integrations/langgraph)
 */
function isFolderActive(indexUrl: string | undefined, pathname: string): boolean {
  if (!indexUrl) return false;
  
  const normalizedIndexUrl = normalizeUrl(indexUrl);
  const normalizedPathname = normalizeUrl(pathname);
  
  // Exact match
  if (normalizedIndexUrl === normalizedPathname) {
    return true;
  }
  
  // Handle index pages: /langgraph should match /langgraph/index
  if (normalizedPathname === normalizedIndexUrl.replace(/\/index$/, '')) {
    return true;
  }
  
  // Handle reverse: /langgraph/index should match /langgraph
  if (normalizedIndexUrl === `${normalizedPathname}/index`) {
    return true;
  }
  
  // Handle rewrite patterns: /langgraph should match /integrations/langgraph
  const pathnameBase = normalizedPathname.replace(/^\/integrations\//, '/');
  const indexUrlBase = normalizedIndexUrl.replace(/^\/integrations\//, '/');
  
  if (pathnameBase === indexUrlBase) {
    return true;
  }
  
  // Handle index with rewrite: /langgraph should match /integrations/langgraph/index
  if (pathnameBase === indexUrlBase.replace(/\/index$/, '')) {
    return true;
  }
  
  if (indexUrlBase === `${pathnameBase}/index`) {
    return true;
  }
  
  return false;
}

const Folder = ({ node }: FolderProps) => {
  const { isFolderOpen, toggleFolder } = useOpenedFolders();
  const pathname = usePathname();
  const isActive = isFolderActive(node?.index?.url, pathname);
  const router = useRouter();
  const folderUrl = node.index?.url;
  const folderId = node.$id;
  const isOpen = folderId ? isFolderOpen(folderId) : false;

  const NODE_COMPONENTS = {
    separator: Separator,
    page: Page,
    folder: Folder,
  };

  const handleLinkClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (folderId) {
        toggleFolder(folderId);
      }
      
      if (folderUrl) {
        router.push(folderUrl);
      }
    },
    [folderUrl, router, folderId, toggleFolder]
  );

  return (
    <div className='w-full'>
      <li
        className={cn(
          'w-full shrink-0 opacity-60 transition-all duration-300 hover:opacity-100 hover:bg-white dark:hover:bg-white/10 rounded-lg',
          isActive && 'opacity-100 bg-white dark:bg-white/10'
        )}>
        <button
          type='button'
          onClick={handleLinkClick}
          className='flex gap-2 justify-between items-center px-3 w-full h-10 cursor-pointer'>
          <span className='w-max text-sm shrink-0'>{node.name}</span>
          <ChevronDownIcon className={cn(isOpen ? 'rotate-180' : '')} />
        </button>
      </li>
      {isOpen && (
        <ul className='flex relative flex-col gap-2 ml-4'>
          <div className='absolute top-1/2 -translate-y-1/2 -left-2 w-px h-[calc(100%-8px)] bg-foreground/10' />

          {(node as { children: Node[] }).children.map(page => {
            const Component = NODE_COMPONENTS[page.type as keyof typeof NODE_COMPONENTS];
            return <Component key={crypto.randomUUID()} node={page as Node} minimal={true} />;
          })}
        </ul>
      )}
    </div>
  );
};

export default Folder;
