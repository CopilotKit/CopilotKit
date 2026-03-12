"use client";

import { JobPosting } from "@/lib/types";

export function JobsResults({ jobs }: { jobs: JobPosting[] }) {
  if (!jobs.length) return null;
  
  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200">
        <h3 className="font-semibold text-slate-900">Jobs</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-gray-800">
            <tr>
              <th className="text-left px-4 py-2">Company</th>
              <th className="text-left px-4 py-2">Title</th>
              <th className="text-left px-4 py-2">Location</th>
              <th className="text-left px-4 py-2">Link</th>
              <th className="text-left px-4 py-2">Good match</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j, idx) => (
              <tr key={idx} className="border-t border-slate-100 text-black">
                <td className="px-4 py-2">{j.company}</td>
                <td className="px-4 py-2">{j.title}</td>
                <td className="px-4 py-2">{j.location}</td>
                <td className="px-4 py-2">
                  <a className="text-blue-600 hover:underline" href={j.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </td>
                <td className="px-4 py-2">{j.goodMatch === true ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}