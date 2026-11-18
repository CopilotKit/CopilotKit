import { describe, it, expect } from "vitest";
import {
  NOTE_MARKER,
  OWNER_NOTICE_TEMPLATES,
  OWNER_NOTICE_TEMPLATE_LABELS,
  REVIEW_FLAG_REASONS,
  REVIEW_FLAG_REASON_LABELS,
  isOwnerNoticeTemplate,
  isReviewFlagReason,
  markNote,
} from "./handling";
import { VARIANCE_CODES } from "./variance-codes";

describe("beat 5's vocabularies are GIVEN to the agent, unlike beat 6's", () => {
  it("labels every value, so a schema and a badge can both name them", () => {
    for (const reason of REVIEW_FLAG_REASONS) {
      expect(REVIEW_FLAG_REASON_LABELS[reason]).toBeTruthy();
    }
    for (const template of OWNER_NOTICE_TEMPLATES) {
      expect(OWNER_NOTICE_TEMPLATE_LABELS[template]).toBeTruthy();
    }
  });

  it("shares no value with the WITHHELD variance catalogue", () => {
    // The two closed sets sit one directory apart and are the easiest pair in
    // this demo to confuse — for a future editor as much as for the model.
    const withheld = new Set<string>(VARIANCE_CODES);
    for (const value of [...REVIEW_FLAG_REASONS, ...OWNER_NOTICE_TEMPLATES]) {
      expect(withheld.has(value)).toBe(false);
    }
  });

  it("does not use beat 6's words anywhere in its vocabulary or labels", () => {
    const text = [
      ...REVIEW_FLAG_REASONS,
      ...OWNER_NOTICE_TEMPLATES,
      ...Object.values(REVIEW_FLAG_REASON_LABELS),
      ...Object.values(OWNER_NOTICE_TEMPLATE_LABELS),
    ].join(" ");
    expect(text).not.toMatch(/variance|release/i);
  });

  it("recognizes its own values and refuses everything else", () => {
    expect(isReviewFlagReason("review-overdue")).toBe(true);
    expect(isReviewFlagReason("REVIEW-OVERDUE")).toBe(false);
    expect(isReviewFlagReason("")).toBe(false);
    expect(isOwnerNoticeTemplate("review-due")).toBe(true);
    expect(isOwnerNoticeTemplate("nope")).toBe(false);
  });
});

describe("markNote", () => {
  it("forces the marker so the change reads from the back of the room", () => {
    expect(markNote("Past its review date.")).toBe(
      `${NOTE_MARKER} Past its review date.`,
    );
  });

  it("is idempotent", () => {
    expect(markNote(`${NOTE_MARKER} Already marked.`)).toBe(
      `${NOTE_MARKER} Already marked.`,
    );
  });

  it("trims before deciding, so a leading space does not defeat it", () => {
    expect(markNote(`  ${NOTE_MARKER} Marked.`)).toBe(`${NOTE_MARKER} Marked.`);
  });
});
