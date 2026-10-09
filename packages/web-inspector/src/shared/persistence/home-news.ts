export const HOME_NEWS_READ_STORAGE_KEY = "cpk:inspector:home-news-read";

export function loadHomeNewsReadIds(storageKey: string): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function saveHomeNewsReadIds(storageKey: string, ids: string[]): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch (error) {
    console.warn("Failed to persist Home news read state", error);
  }
}
