"use client";

import { useSyncExternalStore } from "react";
import type { Argument, DiscourseReport, Post } from "./discourse";

/**
 * The agent's tool calls write here; the canvas reads. Panels appear in the
 * order the model called them, which is what makes the surface generative
 * rather than a fixed dashboard that happens to be filled in.
 */

export type PanelId = "summary" | "sentiment" | "arguments" | "receipts";

interface PanelState {
  /** True from the moment the user asks until the first panel lands. Drives the
   *  wireframe placeholders so the canvas is never dead during the search. */
  pending: boolean;
  order: PanelId[];
  meta: { postsScanned: number; window: string };
  summary?: string;
  sentiment?: { bull: number; bear: number };
  arguments?: Argument[];
  posts?: Post[];
}

const EMPTY: PanelState = {
  pending: false,
  order: [],
  meta: { postsScanned: 0, window: "" },
};

let state: PanelState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  state = { ...state };
  listeners.forEach((l) => l());
}

function place(id: PanelId) {
  state.pending = false;
  state.order = [...state.order.filter((p) => p !== id), id].sort(
    (a, b) => ORDER.indexOf(a) - ORDER.indexOf(b),
  );
}

const ORDER: PanelId[] = ["summary", "sentiment", "arguments", "receipts"];

export const panelStore = {
  reset() {
    state = {
      pending: false,
      order: [],
      meta: { postsScanned: 0, window: "" },
    };
    emit();
  },
  beginSearch() {
    state = { pending: true, order: [], meta: { postsScanned: 0, window: "" } };
    emit();
  },
  setMeta(postsScanned: number, window: string) {
    state.meta = { postsScanned, window };
    emit();
  },
  setSummary(summary: string) {
    state.summary = summary;
    place("summary");
    emit();
  },
  setSentiment(bull: number, bear: number) {
    state.sentiment = { bull, bear };
    place("sentiment");
    emit();
  },
  setArguments(args: Argument[]) {
    state.arguments = args;
    place("arguments");
    emit();
  },
  setPosts(posts: Post[]) {
    state.posts = posts;
    place("receipts");
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get() {
    return state;
  },
};

export function usePanels() {
  return useSyncExternalStore(
    panelStore.subscribe,
    panelStore.get,
    () => EMPTY,
  );
}

/** Panels take a full report shape; build one from whatever the agent has set. */
export function toReport(s: PanelState, query: string): DiscourseReport {
  return {
    query,
    postsScanned: s.meta.postsScanned,
    window: s.meta.window,
    summary: s.summary ?? "",
    sentiment: { ...(s.sentiment ?? { bull: 0, bear: 0 }), neutral: 0 },
    arguments: s.arguments ?? [],
    posts: s.posts ?? [],
  };
}
