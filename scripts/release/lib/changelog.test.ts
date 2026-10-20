import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  CHANGELOG_PATHS,
  extractSection,
  formatSection,
  prependSection,
  removeSection,
  stripVersionHeading,
  upsertSection,
} from "./changelog.js";

const PREAMBLE = `# Changelog — monorepo lane

Every \`@copilotkit/*\` package in the monorepo lane.
`;

describe("CHANGELOG_PATHS", () => {
  it("covers every scope in release.config.json", () => {
    expect(Object.keys(CHANGELOG_PATHS).sort()).toEqual(
      Object.keys(loadConfig().scopes).sort(),
    );
  });

  it("gives each lane its own file", () => {
    const paths = Object.values(CHANGELOG_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("stripVersionHeading", () => {
  it("drops the raw generator's version heading", () => {
    expect(stripVersionHeading("## v1.70.0\n\n### Fixes\n- a", "1.70.0")).toBe(
      "### Fixes\n- a",
    );
  });

  it("drops a scope-labelled version heading", () => {
    expect(stripVersionHeading("## v0.5.0 (angular)\n\n- a", "0.5.0")).toBe(
      "- a",
    );
  });

  it("keeps a leading heading that is not the version", () => {
    // The AI path is told to emit no title, so its first line is a real
    // section. Stripping any leading heading would eat it.
    expect(stripVersionHeading("### Features\n- a", "1.70.0")).toBe(
      "### Features\n- a",
    );
  });
});

describe("formatSection", () => {
  it("writes one dated heading for the version", () => {
    const section = formatSection("1.70.0", "2026-09-02", "### Fixes\n- a");
    expect(section).toBe("## 1.70.0 - 2026-09-02\n\n### Fixes\n- a\n");
  });

  it("does not double up when the notes already carry the heading", () => {
    const section = formatSection("1.70.0", "2026-09-02", "## v1.70.0\n\n- a");
    expect(section.match(/^## /gm)).toHaveLength(1);
  });

  it("records an empty release rather than an empty section", () => {
    expect(formatSection("1.70.0", "2026-09-02", "  \n")).toContain(
      "No changes.",
    );
  });
});

describe("prependSection", () => {
  it("keeps the preamble above the entries", () => {
    const result = prependSection(
      PREAMBLE,
      formatSection("1.70.0", "2026-09-02", "- a"),
    );
    expect(result.indexOf("# Changelog")).toBeLessThan(
      result.indexOf("## 1.70.0"),
    );
  });

  it("puts the new release above the previous one", () => {
    const withOld = prependSection(
      PREAMBLE,
      formatSection("1.69.3", "2026-08-20", "- old"),
    );
    const withNew = prependSection(
      withOld,
      formatSection("1.70.0", "2026-09-02", "- new"),
    );
    expect(withNew.indexOf("## 1.70.0")).toBeLessThan(
      withNew.indexOf("## 1.69.3"),
    );
  });

  it("leaves both releases extractable", () => {
    const withOld = prependSection(
      PREAMBLE,
      formatSection("1.69.3", "2026-08-20", "- old"),
    );
    const withNew = prependSection(
      withOld,
      formatSection("1.70.0", "2026-09-02", "- new"),
    );
    expect(extractSection(withNew, "1.70.0")).toBe("- new");
    expect(extractSection(withNew, "1.69.3")).toBe("- old");
  });
});

describe("extractSection", () => {
  const changelog = prependSection(
    prependSection(PREAMBLE, formatSection("1.69.3", "2026-08-20", "- old")),
    formatSection("1.70.0", "2026-09-02", "### Fixes\n\n- new (#6830)"),
  );

  it("returns the body without the heading", () => {
    // The GitHub Release title already carries the version; a heading in the
    // body renders as a duplicate.
    const body = extractSection(changelog, "1.70.0");
    expect(body).toBe("### Fixes\n\n- new (#6830)");
    expect(body).not.toContain("## 1.70.0");
  });

  it("stops at the next release", () => {
    expect(extractSection(changelog, "1.70.0")).not.toContain("old");
  });

  it("matches a version written with a leading v", () => {
    const withV = `${PREAMBLE}\n## v1.70.0 - 2026-09-02\n\n- a\n`;
    expect(extractSection(withV, "1.70.0")).toBe("- a");
  });

  it("returns null for a version with no section", () => {
    expect(extractSection(changelog, "9.9.9")).toBeNull();
  });

  it("does not treat a heading inside a code fence as a boundary", () => {
    // A migration note with a shell snippet is normal, and `## ` inside it is
    // a comment. Reading it as a section boundary truncates the notes.
    const fenced = `${PREAMBLE}
## 1.70.0 - 2026-09-02

Run this:

\`\`\`bash
## step one
echo hi
\`\`\`

Then done.

## 1.69.3 - 2026-08-20

- old
`;
    const body = extractSection(fenced, "1.70.0");
    expect(body).toContain("## step one");
    expect(body).toContain("Then done.");
    expect(body).not.toContain("old");
  });
});

describe("upsertSection", () => {
  it("replaces a re-run's section instead of stacking a duplicate", () => {
    const first = upsertSection(
      PREAMBLE,
      "1.70.0",
      formatSection("1.70.0", "2026-09-02", "- first"),
    );
    const second = upsertSection(
      first,
      "1.70.0",
      formatSection("1.70.0", "2026-09-02", "- second"),
    );
    expect(second.match(/^## 1\.70\.0/gm)).toHaveLength(1);
    expect(extractSection(second, "1.70.0")).toBe("- second");
  });

  it("leaves earlier releases alone", () => {
    const withOld = prependSection(
      PREAMBLE,
      formatSection("1.69.3", "2026-08-20", "- old"),
    );
    const updated = upsertSection(
      withOld,
      "1.70.0",
      formatSection("1.70.0", "2026-09-02", "- new"),
    );
    expect(extractSection(updated, "1.69.3")).toBe("- old");
  });
});

describe("removeSection", () => {
  it("is a no-op for a version that was never recorded", () => {
    const withOne = prependSection(
      PREAMBLE,
      formatSection("1.70.0", "2026-09-02", "- a"),
    );
    expect(removeSection(withOne, "9.9.9")).toBe(withOne);
  });
});
