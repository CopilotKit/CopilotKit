import { useState, useCallback } from "react";
import { FileEntry } from "@/components/file-tree/file-tree";
import { join } from "path";

export function useFs(initialPath: string) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>();
  const [fileContent, setFileContent] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const listFiles = useCallback(async (path: string) => {
    // try {
    //   console.log("Listing files for path:", path);
    //   setLoading(true);
    //   setError(undefined);
    //   const response = await fetch("/api/fs/list", {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json" },
    //     body: JSON.stringify({ path }),
    //   });
    //   if (!response.ok) {
    //     const errorData = await response.json().catch(() => ({}));
    //     console.error("Failed to list files:", errorData);
    //     throw new Error(errorData.error || "Failed to list files");
    //   }
    //   const { files } = await response.json();
    //   console.log("Files received:", files);
    //   setFiles(files);
    //   setCurrentPath(path);
    // } catch (err) {
    //   console.error("Error in listFiles:", err);
    //   setError(err instanceof Error ? err.message : "Unknown error");
    // } finally {
    //   setLoading(false);
    // }
  }, []);

  const readFile = useCallback(
    async (relativePath: string) => {
      // try {
      //   // Combine the demo path with the relative file path
      //   const fullPath = join(currentPath, relativePath);
      //   console.log('Reading file:', fullPath);
      //   setLoading(true);
      //   setError(undefined);
      //   const response = await fetch('/api/fs/read', {
      //     method: 'POST',
      //     headers: { 'Content-Type': 'application/json' },
      //     body: JSON.stringify({ path: fullPath }),
      //   });
      //   if (!response.ok) {
      //     const errorData = await response.json().catch(() => ({}));
      //     console.error('Failed to read file:', errorData);
      //     throw new Error(errorData.error || 'Failed to read file');
      //   }
      //   const { content } = await response.json();
      //   console.log('File content received, length:', content?.length);
      //   setFileContent(content);
      //   setSelectedFilePath(relativePath); // Keep the relative path for UI
      // } catch (err) {
      //   console.error('Error in readFile:', err);
      //   setError(err instanceof Error ? err.message : 'Unknown error');
      // } finally {
      //   setLoading(false);
      // }
    },
    [currentPath]
  );

  const handleFileSelect = useCallback(
    (path: string) => {
      console.log("File selected:", path);
      readFile(path);
    },
    [readFile]
  );

  const handleNavigate = useCallback(
    (path: string) => {
      console.log("Navigating to:", path);
      listFiles(path);
    },
    [listFiles]
  );

  return {
    currentPath,
    files,
    selectedFilePath,
    fileContent,
    loading,
    error,
    handleFileSelect,
    handleNavigate,
  };
}
