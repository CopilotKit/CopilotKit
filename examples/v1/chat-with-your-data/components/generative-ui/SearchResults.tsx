import React from "react";
import { Search, Loader, CheckCircle, AlertCircle } from "lucide-react";
import { z } from "zod";

const searchResponseSchema = z.object({
  answer: z.string().optional(),
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
});

type SearchResultsProps = {
  query: string;
  status: "executing" | "inProgress" | "complete";
  result: string | undefined;
};

function parseSearchResponse(result: string | undefined) {
  if (!result) {
    return null;
  }

  try {
    const parsed = searchResponseSchema.safeParse(JSON.parse(result));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isSafeSearchResultUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function SearchResults({ query, status, result }: SearchResultsProps) {
  const searchResponse = parseSearchResponse(result);
  const isErrorResult =
    status === "complete" && result?.startsWith("Error:") === true;
  const errorMessage = isErrorResult
    ? result.slice("Error:".length).trim()
    : undefined;

  return (
    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <Search className="h-4 w-4 text-blue-500" />
        <h3 className="text-sm font-medium">Search Results</h3>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        Query: {query}
      </p>

      {status === "executing" && (
        <div className="flex items-center gap-2 text-xs text-blue-500">
          <Loader className="h-3 w-3 animate-spin" />
          <span>Searching...</span>
        </div>
      )}

      {status === "inProgress" && (
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <Loader className="h-3 w-3 animate-spin" />
          <span>Processing...</span>
        </div>
      )}

      {status === "complete" && !isErrorResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-green-500">
            <CheckCircle className="h-3 w-3" />
            <span>Complete</span>
          </div>

          {searchResponse?.answer && (
            <p className="text-sm text-gray-700 dark:text-gray-200">
              {searchResponse.answer}
            </p>
          )}

          {searchResponse?.results.map((searchResult) => (
            <article
              className="space-y-1 border-t border-gray-100 pt-2 dark:border-gray-700"
              key={searchResult.url}
            >
              {isSafeSearchResultUrl(searchResult.url) ? (
                <a
                  className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                  href={searchResult.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {searchResult.title}
                </a>
              ) : (
                <p className="text-sm font-medium">{searchResult.title}</p>
              )}
              <p className="text-xs text-gray-600 dark:text-gray-300">
                {searchResult.content}
              </p>
            </article>
          ))}

          {!searchResponse && result && (
            <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200">
              {result}
            </p>
          )}
        </div>
      )}

      {isErrorResult && (
        <div className="space-y-2 text-red-500">
          <div className="flex items-center gap-2 text-xs">
            <AlertCircle className="h-3 w-3" />
            <span>Error</span>
          </div>
          {errorMessage && <p className="text-sm">{errorMessage}</p>}
        </div>
      )}
    </div>
  );
}
