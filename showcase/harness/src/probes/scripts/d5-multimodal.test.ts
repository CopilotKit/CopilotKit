import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  SAMPLE_IMAGE_BUTTON_SELECTOR,
  SAMPLE_PDF_BUTTON_SELECTOR,
} from "./d5-multimodal.js";

function makePage(transcript: string): Page {
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate() {
      return transcript as never;
    },
  };
}

/**
 * Page fake that records every selector passed to `click()` and
 * `waitForSelector()` so tests can verify the preFill hook clicks the
 * right sample-attachment button. The structural Page interface in
 * `conversation-runner.ts` doesn't declare `click()`, so we extend it
 * here — the multimodal `clickSampleButton` helper feature-detects
 * `click` via `as unknown as { click?: ... }` and we want to satisfy
 * that path.
 */
interface ClickRecordingPage extends Page {
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
}

function makeClickRecordingPage(): {
  page: ClickRecordingPage;
  clicks: string[];
  waitedFor: string[];
} {
  const clicks: string[] = [];
  const waitedFor: string[] = [];
  const page: ClickRecordingPage = {
    async waitForSelector(selector) {
      waitedFor.push(selector);
    },
    async fill() {},
    async press() {},
    async evaluate() {
      return "" as never;
    },
    async click(selector) {
      clicks.push(selector);
    },
  };
  return { page, clicks, waitedFor };
}

describe("d5-multimodal script", () => {
  it("registers under featureType 'multimodal'", () => {
    const script = getD5Script("multimodal");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["multimodal"]);
    expect(script?.fixtureFile).toBe("multimodal.json");
  });

  it("buildTurns produces two turns covering image + PDF", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "multimodal",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.input).toBe("describe the sample image");
    expect(turns[1]!.input).toBe("summarize the sample document");
  });

  it("buildTurns wires preFill on both turns", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "multimodal",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(typeof turns[0]!.preFill).toBe("function");
    expect(typeof turns[1]!.preFill).toBe("function");
  });

  it("turn-1 preFill clicks the sample IMAGE button", async () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "multimodal",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    const { page, clicks, waitedFor } = makeClickRecordingPage();
    await turns[0]!.preFill!(page);
    expect(clicks).toEqual([SAMPLE_IMAGE_BUTTON_SELECTOR]);
    expect(waitedFor).toContain(SAMPLE_IMAGE_BUTTON_SELECTOR);
  });

  it("turn-2 preFill clicks the sample PDF button", async () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "multimodal",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    const { page, clicks, waitedFor } = makeClickRecordingPage();
    await turns[1]!.preFill!(page);
    expect(clicks).toEqual([SAMPLE_PDF_BUTTON_SELECTOR]);
    expect(waitedFor).toContain(SAMPLE_PDF_BUTTON_SELECTOR);
  });

  it("exposes the sample-button selectors", () => {
    expect(SAMPLE_IMAGE_BUTTON_SELECTOR).toBe(
      '[data-testid="multimodal-sample-image-button"]',
    );
    expect(SAMPLE_PDF_BUTTON_SELECTOR).toBe(
      '[data-testid="multimodal-sample-pdf-button"]',
    );
  });

  it("turn-1 assertion succeeds when transcript references 'image'", async () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "multimodal",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    await expect(
      turns[0]!.assertions!(
        makePage("the image attachment shows a small abstract test pattern"),
      ),
    ).resolves.toBeUndefined();
  });

  it("turn-1 assertion fails when transcript lacks 'image'", async () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "multimodal",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    // The internal poll deadline is 5s; raise the vitest timeout so
    // the assertion has time to exhaust its budget and throw the
    // missing-keyword error.
    await expect(
      turns[0]!.assertions!(makePage("nothing here")),
    ).rejects.toThrow(/missing keyword "image"/);
  }, 8_000);
});
