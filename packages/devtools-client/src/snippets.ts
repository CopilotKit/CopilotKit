import type { DevtoolsSnippet } from "./types.js";

const STORAGE_KEY = "cpk:inspector:snippets";

export function loadSnippets(): DevtoolsSnippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn("[CopilotKit DevTools] Snippets data is not an array — ignoring stored value.");
      return [];
    }
    return parsed.filter(
      (s): s is DevtoolsSnippet =>
        s != null &&
        typeof s === "object" &&
        typeof s.id === "string" &&
        typeof s.eventType === "string",
    );
  } catch (err) {
    console.warn("[CopilotKit DevTools] Failed to load snippets:", err);
    return [];
  }
}

export function saveSnippet(snippet: DevtoolsSnippet): boolean {
  try {
    const snippets = loadSnippets();
    snippets.push(snippet);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
    return true;
  } catch (err) {
    console.warn("[CopilotKit DevTools] Failed to save snippet:", err);
    return false;
  }
}

export function updateSnippet(updated: DevtoolsSnippet): boolean {
  try {
    const snippets = loadSnippets();
    const idx = snippets.findIndex((s) => s.id === updated.id);
    if (idx === -1) return false;
    snippets[idx] = updated;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snippets));
    return true;
  } catch (err) {
    console.warn("[CopilotKit DevTools] Failed to update snippet:", err);
    return false;
  }
}

export function deleteSnippet(id: string): boolean {
  try {
    const snippets = loadSnippets();
    const filtered = snippets.filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (err) {
    console.warn("[CopilotKit DevTools] Failed to delete snippet:", err);
    return false;
  }
}
