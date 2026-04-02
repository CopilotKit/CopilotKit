import type { DevtoolsSnippet } from "./types.js";

const STORAGE_KEY = "cpk:inspector:snippets";

export function loadSnippets(): DevtoolsSnippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSnippet(snippet: DevtoolsSnippet): void {
  try {
    const snippets = loadSnippets();
    snippets.push(snippet);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
  } catch (err) {
    console.warn("[CopilotKit DevTools] Failed to save snippet:", err);
  }
}

export function deleteSnippet(id: string): void {
  try {
    const snippets = loadSnippets();
    const filtered = snippets.filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.warn("[CopilotKit DevTools] Failed to delete snippet:", err);
  }
}
