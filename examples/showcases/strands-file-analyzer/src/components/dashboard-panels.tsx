"use client";

import { Finding, RedactedItem, Tweet } from "@/types/investigator";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

// === Findings Panel ===
interface FindingsPanelProps {
  findings: Finding[];
}

const SEVERITY_COLORS: Record<Finding['severity'], string> = {
  low: "bg-green-100 text-green-700 border-green-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  critical: "bg-red-100 text-red-700 border-red-200",
};

export function FindingsPanel({ findings }: FindingsPanelProps) {
  const items = findings ?? [];
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Key Findings</h2>
      </div>

      {items.length === 0 ? (
        <p className="text-slate-400 italic text-sm">
          Nothing to see here... yet. Move along.
        </p>
      ) : (
        <div className="space-y-3 overflow-y-auto flex-1">
          {items.map((finding, index) => (
            <div key={finding.id || `finding-${index}`} className="border border-slate-100 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-medium text-slate-900">{finding.title}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${SEVERITY_COLORS[finding.severity]}`}>
                  {finding.severity}
                </span>
              </div>
              <p className="text-sm text-slate-600">{finding.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// === Redacted Content Panel ===
interface RedactedPanelProps {
  redactedItems: RedactedItem[];
}

export function RedactedPanel({ redactedItems }: RedactedPanelProps) {
  const items = redactedItems ?? [];
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Redacted Content</h2>
      </div>

      {items.length === 0 ? (
        <p className="text-slate-400 italic text-sm">
          No redactions found. This document is surprisingly transparent...
        </p>
      ) : (
        <div className="space-y-3 overflow-y-auto flex-1">
          {items.map((item, index) => (
            <div key={item.id || `redacted-${index}`} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 bg-slate-200 px-2 py-0.5 rounded">
                  {item.location}
                </span>
                <span className="text-xs text-slate-400">
                  {item.confidence}% confident
                </span>
              </div>
              <p className="text-sm text-slate-700 italic">
                &quot;{item.speculation}&quot;
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// === Tweets Panel ===
interface TweetsPanelProps {
  tweets: Tweet[];
  onCopy: (content: string) => void;
  onPost: (id: string) => void;
  onEdit: (id: string, newContent: string) => void;
}

export function TweetsPanel({ tweets, onCopy, onPost, onEdit }: TweetsPanelProps) {
  const items = tweets ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const startEdit = (tweet: Tweet) => {
    setEditingId(tweet.id);
    setEditContent(tweet.content);
  };

  const saveEdit = (id: string) => {
    onEdit(id, editContent);
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        <div className="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-sky-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Generated Tweets</h2>
      </div>

      {items.length === 0 ? (
        <p className="text-slate-400 italic text-sm">
          No tweets yet. The truth wants to be shared...
        </p>
      ) : (
        <div className="space-y-3 overflow-y-auto flex-1">
          {items.map((tweet, index) => (
            <div key={tweet.id || `tweet-${index}`} className="border border-slate-100 rounded-lg p-3">
              {editingId === tweet.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    maxLength={280}
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400">{editContent.length}/280</span>
                    <div className="flex gap-2">
                      <button onClick={cancelEdit} className="text-xs text-slate-500 hover:text-slate-700">
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(tweet.id)}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-800 mb-3">{tweet.content}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(tweet)}
                      className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit
                    </button>
                    <button
                      onClick={() => onCopy(tweet.content)}
                      className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </button>
                    <button
                      onClick={() => onPost(tweet.id)}
                      className={`text-xs flex items-center gap-1 ${
                        tweet.posted
                          ? "text-green-600"
                          : "text-sky-500 hover:text-sky-600"
                      }`}
                    >
                      {tweet.posted ? (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Posted
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                          Post
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// === Summary Panel ===
interface SummaryPanelProps {
  summary: string | null;
}

export function SummaryPanel({ summary }: SummaryPanelProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 mb-4 flex-shrink-0">
        <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Executive Summary</h2>
      </div>

      {!summary ? (
        <p className="text-slate-400 italic text-sm">
          Summary pending. File secured. Unlike some other files...
        </p>
      ) : (
        <div className="text-sm text-slate-700 leading-relaxed overflow-y-auto flex-1 prose prose-sm prose-slate max-w-none">
          <ReactMarkdown>{summary}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
