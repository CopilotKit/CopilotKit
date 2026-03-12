"use client";
import { useDefaultTool } from "@copilotkit/react-core";
import { useRef, useState } from "react";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotReadable } from "@copilotkit/react-core";
import { ResumeUpload } from "./ResumeUpload";
import { JobsResults } from "./JobsResults";
import { JobPosting } from "@/lib/types";

interface ResumeData {
  success: boolean;
  text: string;
  skills: string[];
  filename: string;
}

export function ChatPanel() {
  const [resumeUploaded, setResumeUploaded] = useState(false);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);

  const [targetTitle, setTargetTitle] = useState("Frontend Engineer");
  const [targetLocation, setTargetLocation] = useState("Remote OR Bangalore");
  const [skillsHint, setSkillsHint] = useState("React, Next.js, TypeScript");

  const processedKeyRef = useRef<string | null>(null); // dedupe key
  const [jobs, setJobs] = useState<JobPosting[]>([]);

  useDefaultTool({
    render: ({ name, status, args, result }) => {
      // capture tool result
      if (name === "update_jobs_list" && status === "complete" && result?.jobs_list) {
        const key = JSON.stringify({
          name,
          status,
          len: result.jobs_list.length,
          first: result.jobs_list[0]?.url,
        });
  
        if (processedKeyRef.current !== key) {
        processedKeyRef.current = key;

        queueMicrotask(() => {
          setJobs(result.jobs_list);
        });
      }
      }
  
      return (
        <details className="my-2 rounded border border-slate-200 bg-white p-2 text-xs">
          <summary className="cursor-pointer">
            {status === "complete" ? `Called ${name}` : `Calling ${name}`}
          </summary>
          <div className="mt-2 space-y-1">
            <div>Status: {status}</div>
            <div>
              Args:
              <pre className="whitespace-pre-wrap">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
            <div>
              Result:
              <pre className="whitespace-pre-wrap">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          </div>
        </details>
      );
    },
  });

  useCopilotReadable({
    description: "Job search preferences",
    value: {
      targetTitle,
      targetLocation,
      skillsHint,
      resumeFilename: resumeData?.filename ?? "",
      resumeText: (resumeData?.text ?? "").slice(0, 3000),
      detectedSkills: resumeData?.skills ?? [],
    },
  });

  function handleUploadSuccess(data: ResumeData) {
    setResumeUploaded(true);
    setResumeData(data);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-lg overflow-hidden border border-slate-200">
        <div className="bg-linear-to-r from-blue-600 to-blue-700 px-6 py-4">
          <h2 className="text-xl font-semibold text-white">Chat Assistant</h2>
          <p className="text-blue-100 text-sm">Describe your job search</p>
        </div>

        <div className="h-full min-h-0 overflow-hidden flex flex-col">
          <div className="border-b border-slate-200 p-4 space-y-3 bg-slate-50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target title</label>
                <input
                  className="w-full rounded-md border text-gray-800 border-slate-300 px-3 py-2 text-sm"
                  value={targetTitle}
                  onChange={(e) => setTargetTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target location(s)</label>
                <input
                  className="w-full rounded-md border text-gray-800 border-slate-300 px-3 py-2 text-sm"
                  value={targetLocation}
                  onChange={(e) => setTargetLocation(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Skills hint (optional)</label>
              <textarea
                className="w-full rounded-md border text-gray-800 border-slate-300 px-3 py-2 text-sm"
                rows={2}
                value={skillsHint}
                onChange={(e) => setSkillsHint(e.target.value)}
              />
            </div>

            {!resumeUploaded ? (
              <div className="flex-1 overflow-y-auto p-6 flex justify-center">
                <div className="w-full max-w-sm">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">
                    Upload Your Resume
                  </h3>
                  <ResumeUpload onUploadSuccess={handleUploadSuccess} />
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-hidden">
                <div className="bg-green-50 p-4">
                  <p className="text-sm text-green-800">
                    ✓ <span className="font-semibold">{resumeData?.filename}</span> uploaded
                  </p>
                </div>
                {(resumeData?.skills?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {resumeData!.skills.slice(0, 8).map((skill) => (
                      <span
                        key={skill}
                        className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 border border-green-200"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <div className="h-full min-h-0 overflow-y-auto p-3">
                    <CopilotChat
                      labels={{
                        title: "Job Search",
                        initial: `Try: "Find frontend engineer jobs in Remote or Bangalore with React/Next.js"`,
                      }}
                    />
                    <JobsResults jobs={jobs} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
