import { describe, expect, it } from "vitest";

import {
  classifyContentDrift,
  parseDeployedCommit,
  summarizeDocsDrift,
} from "./check-docs-promote-drift";

describe("parseDeployedCommit", () => {
  it("reads the short SHA the shell already renders", () => {
    const html = `<body><div aria-hidden="true" class="shell-docs-commit-label">54567d1</div></body>`;
    expect(parseDeployedCommit(html)).toBe("54567d1");
  });

  it("reads it regardless of attribute order", () => {
    const html = `<div class="shell-docs-commit-label" aria-hidden="true">d692f25</div>`;
    expect(parseDeployedCommit(html)).toBe("d692f25");
  });

  // The shell distinguishes these three deliberately: `dev` means the build ARG was
  // unset, `unknown` means it was an empty string (a Docker ARG scope bug). Neither is
  // a commit, and treating either as one would resolve to nothing and report the whole
  // content tree as drifted.
  it.each(["dev", "unknown"])("refuses the %s placeholder", (label) => {
    const html = `<div class="shell-docs-commit-label">${label}</div>`;
    expect(parseDeployedCommit(html)).toBeNull();
  });

  it("returns null when the label is absent rather than guessing", () => {
    expect(parseDeployedCommit("<body>no label here</body>")).toBeNull();
  });
});

describe("classifyContentDrift", () => {
  // An added page and a modified page are different findings. A reader hitting an added
  // page gets a 404; a reader hitting a modified page gets stale content and no signal
  // that anything is missing. Only the first is what OSS-1037 was misfiled about.
  it("separates pages a reader cannot reach from pages that are merely stale", () => {
    const nameStatus = [
      "A\tshowcase/shell-docs/src/content/docs/frontends/vue/guides/generative-ui.mdx",
      "M\tshowcase/shell-docs/src/content/docs/quickstart.mdx",
      "A\tshowcase/shell-docs/src/content/docs/integrations/pydantic-ai/agent-app-context.mdx",
      "D\tshowcase/shell-docs/src/content/docs/retired.mdx",
    ].join("\n");

    const drift = classifyContentDrift(nameStatus);

    expect(drift.added).toEqual([
      "showcase/shell-docs/src/content/docs/frontends/vue/guides/generative-ui.mdx",
      "showcase/shell-docs/src/content/docs/integrations/pydantic-ai/agent-app-context.mdx",
    ]);
    expect(drift.modified).toEqual([
      "showcase/shell-docs/src/content/docs/quickstart.mdx",
    ]);
    expect(drift.deleted).toEqual([
      "showcase/shell-docs/src/content/docs/retired.mdx",
    ]);
  });

  it("counts a rename as an added page, because its URL is new", () => {
    const drift = classifyContentDrift(
      "R096\tshowcase/shell-docs/src/content/docs/old.mdx\tshowcase/shell-docs/src/content/docs/new.mdx",
    );

    expect(drift.added).toEqual([
      "showcase/shell-docs/src/content/docs/new.mdx",
    ]);
    expect(drift.deleted).toEqual([
      "showcase/shell-docs/src/content/docs/old.mdx",
    ]);
  });

  it("is empty for an empty diff", () => {
    expect(classifyContentDrift("")).toEqual({
      added: [],
      modified: [],
      deleted: [],
    });
  });
});

describe("summarizeDocsDrift", () => {
  const base = {
    host: "docs.copilotkit.ai",
    deployedSha: "54567d1d12",
    headSha: "80091aa96f",
    maxAgeDays: 3,
  };

  it("passes when prod is serving the current content tree", () => {
    const summary = summarizeDocsDrift({
      ...base,
      drift: { added: [], modified: [], deleted: [] },
      oldestUnpromotedAgeDays: null,
    });

    expect(summary.shouldFail).toBe(false);
    const text = summary.lines.join("\n");
    expect(text).toContain("no docs content is waiting");
    // The check runs against staging too, so the report names the host it read rather
    // than calling every host "prod".
    expect(text).toContain("docs.copilotkit.ai");
  });

  it("names the host it actually read, not the production one", () => {
    const summary = summarizeDocsDrift({
      ...base,
      host: "docs.staging.copilotkit.ai",
      drift: { added: [], modified: [], deleted: [] },
      oldestUnpromotedAgeDays: null,
    });

    expect(summary.lines.join("\n")).toContain("docs.staging.copilotkit.ai");
  });

  // Drift is the normal state between promotes — the gate is manual on purpose. Reporting
  // it is the point; failing on it the moment a PR merges would make the check noise, and
  // a check that is always red is a check nobody reads.
  it("reports fresh drift without failing", () => {
    const summary = summarizeDocsDrift({
      ...base,
      drift: {
        added: ["showcase/shell-docs/src/content/docs/a.mdx"],
        modified: [],
        deleted: [],
      },
      oldestUnpromotedAgeDays: 1,
    });

    expect(summary.shouldFail).toBe(false);
    const text = summary.lines.join("\n");
    expect(text).toContain("1 page");
    expect(text).toContain("showcase/shell-docs/src/content/docs/a.mdx");
  });

  it("fails once the oldest unpromoted page is older than the budget", () => {
    const summary = summarizeDocsDrift({
      ...base,
      drift: {
        added: ["showcase/shell-docs/src/content/docs/a.mdx"],
        modified: ["showcase/shell-docs/src/content/docs/b.mdx"],
        deleted: [],
      },
      oldestUnpromotedAgeDays: 4,
    });

    expect(summary.shouldFail).toBe(true);
    const text = summary.lines.join("\n");
    // Both halves in one sentence: an age alone is ambiguous against its own budget.
    expect(text).toContain("4+ days");
    expect(text).toContain("3-day budget");
    expect(text).toContain("shell-docs");
  });

  // Staleness alone is not reader-visible: a modified page still resolves. An added page
  // past the budget is someone getting a 404 on documentation that exists, so the two are
  // reported with different words even at the same age.
  it("names the reader-visible consequence when an added page is overdue", () => {
    const summary = summarizeDocsDrift({
      ...base,
      drift: {
        added: ["showcase/shell-docs/src/content/docs/a.mdx"],
        modified: [],
        deleted: [],
      },
      oldestUnpromotedAgeDays: 9,
    });

    expect(summary.shouldFail).toBe(true);
    expect(summary.lines.join("\n")).toContain("404");
  });

  it("reports an unreadable label as its own failure, not as zero drift", () => {
    const summary = summarizeDocsDrift({
      ...base,
      deployedSha: null,
      drift: { added: [], modified: [], deleted: [] },
      oldestUnpromotedAgeDays: null,
    });

    expect(summary.shouldFail).toBe(true);
    const text = summary.lines.join("\n");
    expect(text).toContain("could not read");
    // An absent label must never read as "prod is current".
    expect(text).not.toContain("no docs content is waiting");
  });

  it("reports a label that does not resolve in this checkout", () => {
    const summary = summarizeDocsDrift({
      ...base,
      deployedSha: "54567d1",
      resolved: false,
      drift: { added: [], modified: [], deleted: [] },
      oldestUnpromotedAgeDays: null,
    });

    expect(summary.shouldFail).toBe(true);
    expect(summary.lines.join("\n")).toContain("does not resolve");
  });
});
