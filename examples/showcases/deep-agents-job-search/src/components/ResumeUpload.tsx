"use client";

import { useState, FormEvent, ChangeEvent, useRef } from "react";
import { Upload, CheckCircle, AlertCircle } from "lucide-react";

interface ResumeUploadResponse {
  success: boolean;
  text: string;
  skills: string[];
  filename: string;
}

interface ResumeUploadProps {
  onUploadSuccess: (data: ResumeUploadResponse) => void;
}

export function ResumeUpload({ onUploadSuccess }: ResumeUploadProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const validTypes = ["application/pdf", "text/plain"];

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    setSuccess(false);

    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!validTypes.includes(file.type)) {
      setSelectedFile(null);
      setError("Please upload a PDF or TXT file");
      // allow re-selecting same file to re-trigger onChange
      e.target.value = "";
      return;
    }

    setSelectedFile(file);
  }

  async function handleFileUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(false);

    const file = selectedFile;

    if (!file) {
      setError("Please select a file");
      setIsLoading(false);
      return;
    }

    try {
      const uploadFormData = new FormData();
      uploadFormData.append("file", file);

      const response = await fetch("/api/upload-resume", {
        method: "POST",
        body: uploadFormData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const data: ResumeUploadResponse = await response.json();
      setSuccess(true);
      onUploadSuccess(data);

      // reset local selection
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      event.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload resume");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleFileUpload} className="space-y-3">
        <label className="block">
          <div className="flex items-center justify-center px-6 py-10 border-2 border-dashed border-slate-300 rounded-lg hover:border-slate-400 cursor-pointer transition-colors">
            <div className="text-center space-y-2">
              <Upload className="w-8 h-8 text-slate-400 mx-auto" />
              <div>
                <p className="text-sm font-medium text-slate-700">Upload your resume</p>
                <p className="text-xs text-slate-500">PDF or TXT file</p>
                {selectedFile && (
                  <p className="text-xs text-slate-700 mt-2">
                    Selected: {selectedFile.name}
                  </p>
                )}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              name="resume"
              accept=".pdf,.txt"
              className="hidden"
              disabled={isLoading}
              onChange={handleFileChange}
              required
            />
          </div>
        </label>

        <button
          type="submit"
          disabled={isLoading || !selectedFile}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 font-medium transition-colors"
        >
          {isLoading ? "Uploading..." : selectedFile ? "Upload Resume" : "Choose a file"}
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>✓ Resume uploaded successfully</span>
        </div>
      )}
    </div>
  );
}
