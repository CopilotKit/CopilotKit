import { expect, test } from "@playwright/test";
import type { Request } from "@playwright/test";

type Transport = "rest" | "single";

function learningPages(
  request: Request,
  transport: Transport,
): { skillsPage: string; insightsPage: string } | null {
  if (transport === "rest") {
    const url = new URL(request.url());
    if (!url.pathname.endsWith("/inspector-learning")) return null;
    return {
      skillsPage: url.searchParams.get("skillsPage") ?? "",
      insightsPage: url.searchParams.get("insightsPage") ?? "",
    };
  }

  if (request.method() !== "POST") return null;
  let body: {
    method?: unknown;
    params?: Record<string, unknown>;
  };
  try {
    body = request.postDataJSON() as typeof body;
  } catch {
    return null;
  }
  if (body.method !== "inspector/learning") return null;
  return {
    skillsPage: String(body.params?.skillsPage ?? ""),
    insightsPage: String(body.params?.insightsPage ?? ""),
  };
}

for (const transport of ["rest", "single"] as const) {
  test(`keeps Skills and Insights pages independent over ${transport}`, async ({
    page,
  }) => {
    await page.goto(
      `/learning-states.html?state=multiple-skills&fixture=pagination&transport=${transport}`,
    );
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true", {
      timeout: 15_000,
    });

    const skills = page.getByRole("region", { name: "Skills in registry" });
    const insights = page.getByRole("region", { name: "More Insights" });
    const skillsPager = skills.getByRole("navigation", {
      name: "skills pages",
    });
    const insightsPager = insights.getByRole("navigation", {
      name: "insights pages",
    });
    const skillsPrevious = skillsPager.getByRole("button", {
      name: "Previous",
    });
    const skillsNext = skillsPager.getByRole("button", { name: "Next" });
    const insightsPrevious = insightsPager.getByRole("button", {
      name: "Previous",
    });
    const insightsNext = insightsPager.getByRole("button", { name: "Next" });

    await expect(skillsPager.getByText("Page 1 of 2")).toBeVisible();
    await expect(insightsPager.getByText("Page 1 of 2")).toBeVisible();
    await expect(skillsPrevious).toBeDisabled();
    await expect(skillsNext).toBeEnabled();
    await expect(insightsPrevious).toBeDisabled();
    await expect(insightsNext).toBeEnabled();
    await expect(
      skills.getByRole("heading", { name: "verify-refund-request" }),
    ).toBeVisible();
    await expect(
      insights.getByRole("heading", {
        name: /Verify the order before giving refund guidance/,
      }),
    ).toBeVisible();

    const observedPages: Array<{
      skillsPage: string;
      insightsPage: string;
    }> = [];
    page.on("request", (request) => {
      const pages = learningPages(request, transport);
      if (pages) observedPages.push(pages);
    });

    await skillsNext.click();
    await expect(skillsPager.getByText("Page 2 of 2")).toBeVisible();
    await expect(
      skills.getByRole("heading", { name: "explain-payment-state" }),
    ).toBeVisible();
    await expect(
      skills.getByRole("heading", { name: "verify-refund-request" }),
    ).toHaveCount(0);
    await expect(skillsPrevious).toBeEnabled();
    await expect(skillsNext).toBeDisabled();
    await expect(insightsPager.getByText("Page 1 of 2")).toBeVisible();
    await expect(insightsPrevious).toBeDisabled();
    await expect(insightsNext).toBeEnabled();

    await insightsNext.click();
    await expect(insightsPager.getByText("Page 2 of 2")).toBeVisible();
    await expect(
      insights.getByRole("heading", {
        name: /Calculate the return deadline from the delivery date/,
      }),
    ).toBeVisible();
    await expect(
      insights.getByRole("heading", {
        name: /Verify the order before giving refund guidance/,
      }),
    ).toHaveCount(0);
    await expect(insightsPrevious).toBeEnabled();
    await expect(insightsNext).toBeDisabled();
    await expect(skillsPager.getByText("Page 2 of 2")).toBeVisible();
    await expect(skillsPrevious).toBeEnabled();
    await expect(skillsNext).toBeDisabled();

    await skillsPrevious.click();
    await expect(skillsPager.getByText("Page 1 of 2")).toBeVisible();
    await expect(
      skills.getByRole("heading", { name: "verify-refund-request" }),
    ).toBeVisible();
    await expect(skillsPrevious).toBeDisabled();
    await expect(skillsNext).toBeEnabled();
    await expect(insightsPager.getByText("Page 2 of 2")).toBeVisible();

    await insightsPrevious.click();
    await expect(insightsPager.getByText("Page 1 of 2")).toBeVisible();
    await expect(
      insights.getByRole("heading", {
        name: /Verify the order before giving refund guidance/,
      }),
    ).toBeVisible();
    await expect(insightsPrevious).toBeDisabled();
    await expect(insightsNext).toBeEnabled();
    await expect(skillsPager.getByText("Page 1 of 2")).toBeVisible();

    await expect
      .poll(() => observedPages)
      .toEqual([
        { skillsPage: "2", insightsPage: "1" },
        { skillsPage: "2", insightsPage: "2" },
        { skillsPage: "1", insightsPage: "2" },
        { skillsPage: "1", insightsPage: "1" },
      ]);
  });
}
