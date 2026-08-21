import { describe, expect, it } from "vitest";

import {
  getGroupForMenu,
  isInspectorMenuKey,
  shouldUseIconRail,
} from "../inspector-nav.js";

describe("inspector-nav", () => {
  it("accepts live leaf keys and rejects unknown panes", () => {
    expect(isInspectorMenuKey("home")).toBe(true);
    expect(isInspectorMenuKey("whats-new")).toBe(true);
    expect(isInspectorMenuKey("threads")).toBe(true);
    expect(isInspectorMenuKey("learning")).toBe(false);
    expect(isInspectorMenuKey("settings")).toBe(false);
  });

  it("maps leaves onto Home, Workbench, and Inspect", () => {
    expect(getGroupForMenu("home")).toBe("home");
    expect(getGroupForMenu("whats-new")).toBe("home");
    expect(getGroupForMenu("threads")).toBe("workbench");
    expect(getGroupForMenu("memories")).toBe("workbench");
    expect(getGroupForMenu("agents")).toBe("inspect");
  });

  it("uses an icon rail when docked left or under 720px", () => {
    expect(shouldUseIconRail({ dockedLeft: true, width: 900 })).toBe(true);
    expect(shouldUseIconRail({ dockedLeft: false, width: 700 })).toBe(true);
    expect(shouldUseIconRail({ dockedLeft: false, width: 840 })).toBe(false);
  });
});
