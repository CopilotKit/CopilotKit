"use client";

import { useCallback, useState } from "react";
import { UploadedFile } from "@/types/investigator";

interface FileUploadProps {
  onFilesChange: (files: UploadedFile[]) => void;
  currentFiles: UploadedFile[];
}

const MAX_FILE_SIZE = 150 * 1024 * 1024; // 150MB
const MAX_FILES = 10;
const WARN_SIZE = 4.5 * 1024 * 1024; // 4.5MB - files above this use text extraction

const LOADING_MESSAGES = [
  "Checking flight logs...",
  "Cross-referencing guest lists...",
  "Scanning visitor records...",
  "Verifying document authenticity...",
  "Looking for suspicious black bars...",
];

const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]); // Remove data URL prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export function FileUpload({ onFilesChange, currentFiles }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      const newFiles: UploadedFile[] = [];

      setIsLoading(true);
      setLoadingMessage(
        LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]
      );

      for (const file of Array.from(fileList)) {
        // Validate PDF type
        if (file.type !== "application/pdf") {
          alert(`${file.name}: Not a PDF file, skipping`);
          continue;
        }

        // Validate size
        if (file.size > MAX_FILE_SIZE) {
          alert(`${file.name}: Exceeds 150MB limit, skipping`);
          continue;
        }

        // Check duplicates
        if (currentFiles.some((f) => f.name === file.name)) {
          continue; // Skip silently
        }

        try {
          const base64 = await readFileAsBase64(file);
          newFiles.push({
            name: file.name,
            base64,
            mimeType: file.type,
            sizeBytes: file.size,
          });
        } catch (error) {
          console.error(`Failed to read ${file.name}:`, error);
          alert(`${file.name}: Failed to read file`);
        }
      }

      // Enforce max files limit
      const combined = [...currentFiles, ...newFiles].slice(0, MAX_FILES);
      onFilesChange(combined);
      setIsLoading(false);
    },
    [currentFiles, onFilesChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(0)}KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  // Show file list when files exist
  if (currentFiles.length > 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-medium text-slate-700">
            {currentFiles.length} file{currentFiles.length > 1 ? "s" : ""} ready
          </span>
          <button
            onClick={() => onFilesChange([])}
            className="text-sm text-red-500 hover:text-red-700"
          >
            Clear all
          </button>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {currentFiles.map((file) => (
            <div
              key={file.name}
              className="flex items-center gap-2 p-2 bg-slate-50 rounded"
            >
              <svg
                className="w-4 h-4 text-blue-600 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <span className="flex-1 text-sm truncate" title={file.name}>
                {file.name}
              </span>
              <span className="text-xs text-slate-400 flex-shrink-0">
                {formatSize(file.sizeBytes)}
              </span>
              {file.sizeBytes > WARN_SIZE && (
                <span
                  className="text-xs text-amber-500 flex-shrink-0"
                  title="Large file - text will be extracted"
                >
                  (text)
                </span>
              )}
              <button
                onClick={() =>
                  onFilesChange(currentFiles.filter((f) => f.name !== file.name))
                }
                className="text-slate-400 hover:text-red-500 flex-shrink-0"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
        {currentFiles.length < MAX_FILES && (
          <label className="mt-3 block text-center text-sm text-blue-600 cursor-pointer hover:text-blue-700">
            + Add more files
            <input
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) handleFiles(e.target.files);
                e.target.value = ""; // Reset to allow re-selecting same file
              }}
            />
          </label>
        )}
      </div>
    );
  }

  // Show dropzone when no files
  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`
        relative border-2 border-dashed rounded-xl p-8 text-center transition-all
        ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 hover:border-slate-400 bg-white"
        }
      `}
    >
      {isLoading ? (
        <div className="space-y-3">
          <div className="w-12 h-12 mx-auto border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-slate-600 italic">{loadingMessage}</p>
        </div>
      ) : (
        <>
          <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <p className="text-slate-600 mb-1">
            Drag and drop your PDFs here, or{" "}
            <label className="text-blue-600 hover:text-blue-700 cursor-pointer font-medium">
              browse
              <input
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </p>
          <p className="text-sm text-slate-400">
            Up to {MAX_FILES} files, 150MB each. Large files analyzed via text
            extraction.
          </p>
        </>
      )}
    </div>
  );
}
