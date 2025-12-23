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

const Folder = ({ node }: FolderProps) => {
  const { isFolderOpen, toggleFolder } = useOpenedFolders();
  const pathname = usePathname();
  const isActive = node?.index?.url === pathname;
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
      
      if (isActive) return;
      
      if (folderId) {
        toggleFolder(folderId);
      }
      
      if (folderUrl) {
        router.push(folderUrl);
      }
    },
    [isActive, folderUrl, router, folderId, toggleFolder]
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
