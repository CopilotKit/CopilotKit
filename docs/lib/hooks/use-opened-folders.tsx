'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface OpenedFoldersContextType {
  openedFolderIds: Set<string>;
  toggleFolder: (folderId: string) => void;
  isFolderOpen: (folderId: string) => boolean;
}

const OpenedFoldersContext = createContext<OpenedFoldersContextType | undefined>(undefined);

export const OpenedFoldersProvider = ({ children }: { children: ReactNode }) => {
  const [openedFolderIds, setOpenedFolderIds] = useState<Set<string>>(new Set());

  const toggleFolder = useCallback((folderId: string) => {
    setOpenedFolderIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  }, []);

  const isFolderOpen = useCallback((folderId: string) => {
    return openedFolderIds.has(folderId);
  }, [openedFolderIds]);

  return (
    <OpenedFoldersContext.Provider value={{ openedFolderIds, toggleFolder, isFolderOpen }}>
      {children}
    </OpenedFoldersContext.Provider>
  );
};

export const useOpenedFolders = () => {
  const context = useContext(OpenedFoldersContext);
  if (context === undefined) {
    throw new Error('useOpenedFolders must be used within an OpenedFoldersProvider');
  }
  return context;
};

