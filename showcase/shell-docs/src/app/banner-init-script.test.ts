import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const LAYOUT = join(__dirname, "layout.tsx");
const DISMISS_KEY = "nd-banner-rotating-banner";
const LEGACY_KEY = "shell-docs-course-banner-dismissed";
const DISMISSED_AT_KEY = "nd-banner-rotating-banner-dismissed-at";
const REAPPEAR_MS = 259200000;

function bannerInitSource(): { tag: string; script: string } {
  const source = readFileSync(LAYOUT, "utf8");
  const idAt = source.indexOf('id="banner-init"');
  expect(idAt).toBeGreaterThan(-1);
  const tagStart = source.lastIndexOf("<", idAt);
  const tagEnd = source.indexOf("/>", idAt);
  const tag = source.slice(tagStart, tagEnd);
  const match = tag.match(/__html:\s*`([^`]*)`/);
  expect(match?.[1]).toBeTruthy();
  return { tag, script: match![1]! };
}

function runBannerInit(
  storage: Record<string, string>,
  now: number,
): { classes: Set<string>; height: string | undefined } {
  const { script } = bannerInitSource();
  const classes = new Set<string>();
  const props = new Map<string, string>();
  const document = {
    documentElement: {
      classList: { add: (name: string) => classes.add(name) },
      style: {
        setProperty: (name: string, value: string) => props.set(name, value),
      },
    },
  };
  const localStorage = {
    getItem: (key: string) => storage[key] ?? null,
  };
  const DateShim = { now: () => now };
  runInNewContext(script, { document, localStorage, Date: DateShim });
  return { classes, height: props.get("--fd-banner-height") };
}

describe("banner init head script", () => {
  it("is a raw head script so it runs during HTML parse", () => {
    const { tag } = bannerInitSource();
    expect(tag.startsWith("<script")).toBe(true);
    expect(tag).not.toContain("<Script");
    expect(tag).not.toContain("strategy=");
    expect(tag).toContain("dangerouslySetInnerHTML");
  });

  it("hides a banner dismissed inside the reappear window", () => {
    const now = 1_700_000_000_000;
    const result = runBannerInit(
      {
        [DISMISS_KEY]: "true",
        [DISMISSED_AT_KEY]: String(now - 60_000),
      },
      now,
    );
    expect(result.classes.has("banner-dismissed")).toBe(true);
    expect(result.height).toBe("0px");
  });

  it("hides a banner dismissed under the legacy storage key", () => {
    const now = 1_700_000_000_000;
    const result = runBannerInit({ [LEGACY_KEY]: "true" }, now);
    expect(result.classes.has("banner-dismissed")).toBe(true);
    expect(result.height).toBe("0px");
  });

  it("reserves 40px when the banner has not been dismissed", () => {
    const result = runBannerInit({}, 1_700_000_000_000);
    expect(result.classes.has("banner-dismissed")).toBe(false);
    expect(result.height).toBe("40px");
  });

  it("reserves 40px after the reappear delay elapses", () => {
    const now = 1_700_000_000_000;
    const result = runBannerInit(
      {
        [DISMISS_KEY]: "true",
        [DISMISSED_AT_KEY]: String(now - REAPPEAR_MS),
      },
      now,
    );
    expect(result.classes.has("banner-dismissed")).toBe(false);
    expect(result.height).toBe("40px");
  });
});
