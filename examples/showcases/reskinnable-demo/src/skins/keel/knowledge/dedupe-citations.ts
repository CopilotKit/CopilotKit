/**
 * Pure citation-list utilities. TYPE-ONLY dependency on the corpus types, so it
 * is safe to import from both the server tool and the client `showSources`
 * component without pulling the corpus into the browser bundle.
 */
import type { Citation } from "./types";

/**
 * Collapse a citation list to one entry per distinct `(docId, sectionId)`
 * passage, preserving first-seen order.
 *
 * The `showSources` tool takes `(docId, sectionId)` pairs straight from the
 * agent, and nothing stops it from listing the same passage twice. A duplicate
 * passage carries no additional information (identical ref, heading, snippet)
 * and would collide any `docId#sectionId`-based React key, so we drop repeats
 * before rendering.
 */
export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    const key = `${c.docId}#${c.sectionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
