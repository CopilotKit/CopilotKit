'use client';

import { useState, useMemo } from 'react';
import { DocsLayoutProps } from 'fumadocs-ui/layouts/docs';
import Separator from '../ui/sidebar/separator';
import Page from '../ui/sidebar/page';
import Folder from '../ui/sidebar/folder';
import IntegrationSelector, { Integration } from '../ui/integrations-sidebar/integration-selector';
import IntegrationSelectorSkeleton from '../ui/integrations-sidebar/skeleton';
import { OpenedFoldersProvider } from '@/lib/hooks/use-opened-folders';
import { getIntegration } from '@/lib/integrations';

type Node = DocsLayoutProps['tree']['children'][number] & {
  url: string;
  index?: { url: string };
  children?: Node[];
};

const NODE_COMPONENTS = {
  separator: Separator,
  page: Page,
  folder: Folder,
};

const IntegrationsSidebar = ({ pageTree }: { pageTree: DocsLayoutProps['tree'] }) => {
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);

  const integrationPages = useMemo(() => {
    if (!selectedIntegration) return [];

    // Get the integration metadata to find the display name
    const integrationMeta = getIntegration(selectedIntegration);
    const integrationLabel = integrationMeta.label;

    // Find the integration folder by matching the name
    const integrationFolder = pageTree.children.find(node => {
      const folderNode = node as Node;
      return folderNode.type === 'folder' && folderNode.name === integrationLabel;
    }) as Node | undefined;

    return integrationFolder?.children ?? [];
  }, [selectedIntegration, pageTree.children]);

  return (
    <OpenedFoldersProvider>
      <aside
        id='nd-sidebar'
        className='w-full flex-col max-w-[260px] h-full border backdrop-blur-lg border-r-0 border-border bg-glass-background rounded-l-2xl pl-3 pr-3 hidden lg:flex'>
        <IntegrationSelector
          selectedIntegration={selectedIntegration}
          setSelectedIntegration={setSelectedIntegration}
        />

        {selectedIntegration ? (
          <ul className='flex overflow-y-auto flex-col pr-1 max-h-full custom-scrollbar'>
            <li className='w-full h-6' />
            {integrationPages.map(page => {
              const Component = NODE_COMPONENTS[page.type];
              return <Component key={crypto.randomUUID()} node={page as Node} />;
            })}
          </ul>
        ) : (
          <IntegrationSelectorSkeleton />
        )}
      </aside>
    </OpenedFoldersProvider>
  );
};

export default IntegrationsSidebar;
