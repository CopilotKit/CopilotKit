import { describe, expect, it } from "vitest";

import {
  consumeSidebarFolderOpenOnce,
  FRONTEND_QUICKSTART_FOLDER_LABEL,
  requestSidebarFolderOpenOnce,
  resolveSidebarFolderDesiredState,
  sidebarHrefMatchesPathname,
  SIDEBAR_FOLDER_OPEN_ONCE_STORAGE_KEY,
  SIDEBAR_FOLDER_STATE_STORAGE_KEY,
} from "../sidebar-folder-state";

class MemoryStorage {
  private readonly items = new Map<string, string>();

  getItem(key: string) {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.items.set(key, value);
  }

  removeItem(key: string) {
    this.items.delete(key);
  }
}

describe("sidebar folder state", () => {
  it("opens a folder that contains the selected page even when the saved preference is closed", () => {
    expect(
      resolveSidebarFolderDesiredState({
        containsSelectedPage: true,
        openOnceRequested: false,
        savedState: "closed",
      }),
    ).toBe("open");
  });

  it("matches sidebar links to the selected pathname without query strings or trailing slash differences", () => {
    expect(
      sidebarHrefMatchesPathname(
        "/langgraph-python/react-native?tab=start#install",
        "/langgraph-python/react-native/",
        "http://localhost:3003",
      ),
    ).toBe(true);
  });

  it("consumes frontend quickstart open requests once without changing saved folder preferences", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SIDEBAR_FOLDER_STATE_STORAGE_KEY,
      JSON.stringify({ [FRONTEND_QUICKSTART_FOLDER_LABEL]: "closed" }),
    );

    requestSidebarFolderOpenOnce(FRONTEND_QUICKSTART_FOLDER_LABEL, storage);

    expect(storage.getItem(SIDEBAR_FOLDER_OPEN_ONCE_STORAGE_KEY)).toBe(
      FRONTEND_QUICKSTART_FOLDER_LABEL,
    );
    expect(
      consumeSidebarFolderOpenOnce(FRONTEND_QUICKSTART_FOLDER_LABEL, storage),
    ).toBe(true);
    expect(
      consumeSidebarFolderOpenOnce(FRONTEND_QUICKSTART_FOLDER_LABEL, storage),
    ).toBe(false);
    expect(storage.getItem(SIDEBAR_FOLDER_STATE_STORAGE_KEY)).toBe(
      JSON.stringify({ [FRONTEND_QUICKSTART_FOLDER_LABEL]: "closed" }),
    );
  });
});
