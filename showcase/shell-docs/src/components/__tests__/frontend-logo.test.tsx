import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FrontendLogo } from "../frontend-logo";

describe("FrontendLogo", () => {
  it("renders brand logo paths from icon libraries", () => {
    expect(renderToStaticMarkup(<FrontendLogo icon="react" />)).toContain(
      "M14.23 12.004",
    );
    expect(renderToStaticMarkup(<FrontendLogo icon="vue" />)).toContain(
      "M24,1.61H14.06L12,5.16",
    );
    const slackMarkup = renderToStaticMarkup(<FrontendLogo icon="slack" />);
    expect(slackMarkup).toContain("M5.042 15.165a2.528");
    expect(slackMarkup).toContain('fill="#36C5F0"');
    expect(slackMarkup).toContain('fill="#2EB67D"');
    expect(slackMarkup).toContain('fill="#ECB22E"');
    expect(slackMarkup).toContain('fill="#E01E5A"');
    expect(renderToStaticMarkup(<FrontendLogo icon="teams" />)).toContain(
      "M18.581 11.513h3.413",
    );
    expect(
      renderToStaticMarkup(<FrontendLogo icon="react-native" />),
    ).toContain("M6.357 9c-2.637");
  });
});
