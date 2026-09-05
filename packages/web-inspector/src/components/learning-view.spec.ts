import { describe, expect, it } from "vitest";
import type { InspectorLearningSnapshotV1 } from "@copilotkit/shared";
import type { CpkLearningView } from "./learning-view.js";
import { deriveLearningViewState } from "./learning-view.js";

function snapshot(
  overrides: Partial<InspectorLearningSnapshotV1> = {},
): InspectorLearningSnapshotV1 {
  return {
    schemaVersion: 1,
    projectKey: "project-safe-key",
    snapshotVersion: "snapshot-1",
    webAppOrigin: "https://app.copilotkit.ai",
    configuration: { state: "not_configured" },
    pendingThreadCount: 0,
    run: { hasActiveRun: false, hasEverSucceeded: false, latest: null },
    pendingCandidateCount: 0,
    skillsPage: {
      page: 1,
      pageSize: 3,
      total: 0,
      totalPages: 0,
      items: [],
    },
    insightsPage: {
      page: 1,
      pageSize: 4,
      total: 0,
      totalPages: 0,
      items: [],
    },
    links: {
      learning: "https://app.copilotkit.ai/learning",
      candidates: null,
      runs: null,
    },
    ...overrides,
  };
}

const state = (
  current: InspectorLearningSnapshotV1 | null,
  overrides: Partial<Parameters<typeof deriveLearningViewState>[0]> = {},
) =>
  deriveLearningViewState({
    supported: true,
    loading: false,
    error: null,
    snapshot: current,
    setupActive: false,
    ...overrides,
  });

describe("Learning state precedence", () => {
  it("prioritizes capability, initial load, fatal error, and scope failures", () => {
    expect(state(null, { supported: false })).toBe("unsupported");
    expect(state(null, { loading: true })).toBe("loading");
    expect(state(null, { error: "offline" })).toBe("error");
    expect(
      state(snapshot({ configuration: { state: "selection_required" } })),
    ).toBe("selection_required");
    expect(
      state(
        snapshot({
          configuration: { state: "invalid", reason: "instrumentation" },
        }),
      ),
    ).toBe("invalid");
  });

  it("orders results, first run, ready, empty, setup, and landing", () => {
    const configured = {
      state: "configured" as const,
      container: { id: "container-1", name: "Production" },
    };
    expect(state(snapshot({ pendingCandidateCount: 1 }))).toBe("results");
    expect(
      state(
        snapshot({
          configuration: configured,
          run: { hasActiveRun: true, hasEverSucceeded: false, latest: null },
        }),
      ),
    ).toBe("first_run");
    expect(
      state(snapshot({ configuration: configured, pendingThreadCount: 2 })),
    ).toBe("ready");
    expect(
      state(
        snapshot({
          configuration: configured,
          run: { hasActiveRun: false, hasEverSucceeded: true, latest: null },
        }),
      ),
    ).toBe("empty");
    expect(state(snapshot({ configuration: configured }))).toBe("setup");
    expect(state(snapshot(), { setupActive: true })).toBe("setup");
    expect(state(snapshot())).toBe("landing");
  });
});

describe("Learning results hierarchy", () => {
  const resultSnapshot = snapshot({
    configuration: {
      state: "configured",
      container: { id: "container-1", name: "Production" },
    },
    skillsPage: {
      page: 1,
      pageSize: 3,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: "skill-1",
          name: "escalation-summary",
          description: "Summarize the decision before escalating.",
          revision: 2,
          skillMd: "---\nname: escalation-summary\n---\n<script>no()</script>",
          sourceInsight: {
            id: "source-1",
            statement: "Escalations succeed with a decision summary.",
            impact: "Reduces repeat questions.",
            totalThreadCount: 3,
            evidenceTruncated: false,
            evidence: [],
          },
        },
      ],
    },
    insightsPage: {
      page: 1,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: "insight-1",
          statement: "Customers confirm ownership faster with a named owner.",
          impact: "Shortens handoffs.",
          totalThreadCount: 2,
          evidenceTruncated: false,
          evidence: [],
        },
      ],
    },
  });

  async function renderResults() {
    const view = document.createElement("cpk-learning-view") as CpkLearningView;
    view.supported = true;
    view.snapshot = resultSnapshot;
    document.body.append(view);
    await view.updateComplete;
    return view;
  }

  it("keeps Skills first and renders the first SKILL.md in a native disclosure", async () => {
    const view = await renderResults();
    const headings = [...view.shadowRoot!.querySelectorAll("h2")].map(
      (heading) => heading.textContent?.trim(),
    );
    expect(headings).toEqual(["Skills in registry", "More Insights"]);
    const disclosure = view.shadowRoot!.querySelector("details");
    expect(disclosure?.open).toBe(true);
    expect(disclosure?.querySelector("summary")?.textContent).toContain(
      "View SKILL.md",
    );
    expect(disclosure?.querySelector("pre")?.textContent).toContain(
      "<script>no()</script>",
    );
    expect(disclosure?.querySelector("script")).toBeNull();
    view.remove();
  });

  it("keeps the empty-result web-app management link quiet and safe", async () => {
    const view = document.createElement("cpk-learning-view") as CpkLearningView;
    view.supported = true;
    view.snapshot = snapshot({
      configuration: {
        state: "configured",
        container: { id: "container-1", name: "Production" },
      },
      run: {
        hasActiveRun: false,
        hasEverSucceeded: true,
        latest: null,
      },
      links: {
        learning: "https://app.copilotkit.ai/learning?project=project-safe-key",
        candidates: null,
        runs: null,
      },
    });
    document.body.append(view);
    await view.updateComplete;

    const link =
      view.shadowRoot!.querySelector<HTMLAnchorElement>("a.quiet-link");
    expect(link?.textContent?.trim()).toBe("Open in web app ↗");
    expect(link?.href).toBe(
      "https://app.copilotkit.ai/learning?project=project-safe-key",
    );
    expect(link?.target).toBe("_blank");
    expect(link?.rel.split(/\s+/).sort()).toEqual(["noopener", "noreferrer"]);
    view.remove();
  });

  it("labels evidence, shows impact and Thread count, and emits on detail open", async () => {
    const view = await renderResults();
    let opened = 0;
    view.addEventListener("learning-evidence-opened", () => {
      opened += 1;
    });
    const labels = [
      ...view.shadowRoot!.querySelectorAll(".list-header span"),
    ].map((label) => label.textContent);
    expect(labels).toEqual(["Pattern", "Evidence"]);
    const row =
      view.shadowRoot!.querySelector<HTMLButtonElement>(".insight-row");
    expect(row?.textContent).toContain("Shortens handoffs.");
    expect(row?.textContent).toMatch(/2\s*Threads/);
    row?.click();
    await view.updateComplete;
    expect(opened).toBe(1);
    expect(view.shadowRoot!.textContent).toContain(
      "Evidence is no longer available",
    );
    view.remove();
  });

  it("keeps unavailable evidence inert and preserves the unnamed accessible Thread fallback", async () => {
    const view = await renderResults();
    view.snapshot = snapshot({
      configuration: {
        state: "configured",
        container: { id: "container-1", name: "Production" },
      },
      insightsPage: {
        page: 1,
        pageSize: 4,
        total: 1,
        totalPages: 1,
        items: [
          {
            id: "insight-private",
            statement: "Evidence availability is checked before navigation.",
            impact: "Deleted evidence stays private.",
            totalThreadCount: 2,
            evidenceTruncated: false,
            evidence: [
              { status: "unavailable" },
              {
                status: "available",
                threadId: "thread-accessible",
                threadName: null,
                messageIds: ["message-accessible"],
                updatedAt: "2026-03-10T09:15:00.000Z",
              },
            ],
          },
        ],
      },
    });
    await view.updateComplete;
    view.shadowRoot?.querySelector<HTMLButtonElement>(".insight-row")?.click();
    await view.updateComplete;

    const unavailable = view.shadowRoot!.querySelector(".evidence-unavailable");
    expect(unavailable?.textContent?.trim()).toBe(
      "Evidence is no longer available",
    );
    expect(unavailable?.querySelector("button, a")).toBeNull();
    const accessible =
      view.shadowRoot!.querySelector<HTMLButtonElement>(".evidence-link");
    expect(accessible?.textContent).toContain("Thread thread-a");
    expect(view.shadowRoot!.textContent).not.toContain("message-accessible");
    view.remove();
  });
});

describe("Learning setup progress", () => {
  async function renderProgress(
    current: InspectorLearningSnapshotV1,
    setupActive = false,
  ) {
    const view = document.createElement("cpk-learning-view") as CpkLearningView;
    view.supported = true;
    view.snapshot = current;
    view.setupActive = setupActive;
    document.body.append(view);
    await view.updateComplete;
    return view;
  }

  it("shows all three setup steps and keeps analysis disabled while waiting", async () => {
    const view = await renderProgress(snapshot(), true);
    expect(view.shadowRoot!.textContent).toContain("1 of 3 steps");
    expect(view.shadowRoot!.textContent).toContain(
      "Waiting for the first Thread",
    );
    expect(view.shadowRoot!.querySelectorAll(".step")).toHaveLength(3);
    expect(
      view.shadowRoot!.querySelector<HTMLButtonElement>("button[disabled]")
        ?.textContent,
    ).toContain("Analyze Threads");
    view.remove();
  });

  it("marks Thread capture complete before handing a ready run to the web app", async () => {
    const view = await renderProgress(
      snapshot({
        configuration: {
          state: "configured",
          container: { id: "container-1", name: "Production" },
        },
        pendingThreadCount: 3,
        links: {
          learning: "https://app.copilotkit.ai/learning",
          candidates: null,
          runs: "https://app.copilotkit.ai/learning?tab=runs",
        },
      }),
    );
    expect(view.shadowRoot!.textContent).toContain("2 of 3 steps");
    expect(view.shadowRoot!.textContent).toContain("Threads ready to analyze");
    expect(view.shadowRoot!.textContent).toMatch(/3\s*New Threads/);
    expect(view.shadowRoot!.querySelector("a")?.textContent).toContain(
      "Open in web app",
    );
    view.remove();
  });

  it("renders setup failures as an alert at step two", async () => {
    const view = await renderProgress(
      snapshot({
        configuration: { state: "invalid", reason: "instrumentation" },
      }),
    );
    expect(view.shadowRoot!.textContent).toContain("Needs attention");
    expect(
      view.shadowRoot!.querySelector('[role="alert"]')?.textContent,
    ).toContain("Inspector did not find the Learning container");
    view.remove();
  });
});
