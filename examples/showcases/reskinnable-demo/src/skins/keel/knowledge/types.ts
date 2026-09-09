/**
 * Knowledge-corpus types for the Keel skin. SERVER-SAFE: imported by both the
 * server-side agent tool (agent.ts → knowledge/search.ts) and the client
 * Knowledge pages, so it must never pull in React or any .tsx module.
 */

/** The three top-level corpus spaces at Harbor Point Health. */
export type KnowledgeSpace = "privacy" | "clinical" | "vendor";

/** One anchored section within a document. `id` is the URL fragment. */
export interface DocSection {
  id: string;
  heading: string;
  body: string;
}

/** A policy/standard document in the corpus. */
export interface KnowledgeDoc {
  id: string;
  space: KnowledgeSpace;
  title: string;
  /** The citable document number, e.g. "POL-114". */
  ref: string;
  owner: string;
  /** ISO date, e.g. "2026-03-14". */
  updated: string;
  sections: DocSection[];
}

/**
 * A retrieval hit. This is the wire shape the server `search_knowledge` tool
 * returns and the shape the `showSources` frontend component renders.
 */
export interface Citation {
  docId: string;
  ref: string;
  sectionId: string;
  heading: string;
  /** ~200 characters of the matched section body. */
  snippet: string;
}

/** The `search_knowledge` server tool's return payload. */
export interface SearchResult {
  passages: Citation[];
  /** Set when nothing matched, so the agent has an unambiguous miss signal. */
  note?: string;
}
