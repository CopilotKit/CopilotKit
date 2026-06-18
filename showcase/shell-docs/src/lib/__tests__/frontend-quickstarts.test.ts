import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  FRONTEND_QUICKSTARTS,
  frontendQuickstartContentSlugPath,
  frontendQuickstartHref,
  selectedFrontendQuickstart,
} from "../frontend-quickstarts";

const CONTENT_DOCS_DIR = path.join(process.cwd(), "src/content/docs");
const GUIDE_PROGRESS_CALLOUT_COPY =
  "Feature parity is here, but this guide content is still in progress.";

describe("frontend quickstart routing", () => {
  it("routes root frontend choices to top-level frontend slugs", () => {
    expect(frontendQuickstartHref(null, "react")).toBe("/react");
    expect(frontendQuickstartHref("built-in-agent", "vue")).toBe("/vue");
    expect(frontendQuickstartHref("built-in-agent", "react-native")).toBe(
      "/react-native",
    );
    expect(frontendQuickstartHref("built-in-agent", "slack")).toBe("/slack");
    expect(frontendQuickstartHref("built-in-agent", "microsoft-teams")).toBe(
      "/microsoft-teams",
    );
  });

  it("routes backend-scoped frontend choices to frontend slugs under the backend", () => {
    expect(frontendQuickstartHref("langgraph-python", "react")).toBe(
      "/langgraph-python/react",
    );
    expect(frontendQuickstartHref("langgraph-python", "vue")).toBe(
      "/langgraph-python/vue",
    );
    expect(frontendQuickstartHref("langgraph-python", "react-native")).toBe(
      "/langgraph-python/react-native",
    );
    expect(frontendQuickstartHref("langgraph-python", "slack")).toBe(
      "/langgraph-python/slack",
    );
    expect(frontendQuickstartHref("langgraph-python", "microsoft-teams")).toBe(
      "/langgraph-python/microsoft-teams",
    );
  });

  it("aliases frontend routes to the existing MDX sources", () => {
    expect(frontendQuickstartContentSlugPath("react")).toBe("quickstart");
    expect(frontendQuickstartContentSlugPath("vue")).toBe("vue");
    expect(frontendQuickstartContentSlugPath("react-native")).toBe(
      "react-native",
    );
    expect(frontendQuickstartContentSlugPath("slack")).toBe("slack");
    expect(frontendQuickstartContentSlugPath("microsoft-teams")).toBe(
      "microsoft-teams",
    );
    expect(frontendQuickstartContentSlugPath("quickstart/react")).toBe(
      "quickstart",
    );
    expect(frontendQuickstartContentSlugPath("quickstart/vue")).toBe("vue");
    expect(frontendQuickstartContentSlugPath("quickstart/react-native")).toBe(
      "react-native",
    );
    expect(frontendQuickstartContentSlugPath("quickstart/slack")).toBe("slack");
    expect(
      frontendQuickstartContentSlugPath("quickstart/microsoft-teams"),
    ).toBe("microsoft-teams");
  });

  it("recognizes both new quickstart routes and legacy frontend routes", () => {
    expect(selectedFrontendQuickstart("react")).toBe("react");
    expect(selectedFrontendQuickstart("vue")).toBe("vue");
    expect(selectedFrontendQuickstart("react-native")).toBe("react-native");
    expect(selectedFrontendQuickstart("slack")).toBe("slack");
    expect(selectedFrontendQuickstart("microsoft-teams")).toBe(
      "microsoft-teams",
    );
    expect(selectedFrontendQuickstart("quickstart")).toBe("react");
    expect(selectedFrontendQuickstart("quickstart/react")).toBe("react");
    expect(selectedFrontendQuickstart("quickstart/vue")).toBe("vue");
    expect(selectedFrontendQuickstart("quickstart/react-native")).toBe(
      "react-native",
    );
    expect(selectedFrontendQuickstart("quickstart/slack")).toBe("slack");
    expect(selectedFrontendQuickstart("quickstart/microsoft-teams")).toBe(
      "microsoft-teams",
    );
  });

  it("defines branded icon keys for every frontend option", () => {
    expect(
      FRONTEND_QUICKSTARTS.map(({ slug, label, iconKey }) => ({
        slug,
        label,
        iconKey,
      })),
    ).toEqual([
      {
        slug: "react",
        label: "React",
        iconKey: "react",
      },
      { slug: "vue", label: "Vue", iconKey: "vue" },
      {
        slug: "react-native",
        label: "React Native",
        iconKey: "react-native",
      },
      { slug: "slack", label: "Slack", iconKey: "slack" },
      {
        slug: "microsoft-teams",
        label: "Microsoft Teams",
        iconKey: "microsoft-teams",
      },
    ]);
  });

  it("adds guide progress callouts only to non-react frontend quickstarts", () => {
    for (const quickstart of FRONTEND_QUICKSTARTS) {
      const filePath = path.join(
        CONTENT_DOCS_DIR,
        `${quickstart.sourceSlugPath}.mdx`,
      );
      const content = fs.readFileSync(filePath, "utf8");

      if (quickstart.slug === "react") {
        expect(content).not.toContain(GUIDE_PROGRESS_CALLOUT_COPY);
      } else {
        expect(content).toContain(GUIDE_PROGRESS_CALLOUT_COPY);
      }
    }
  });
});
