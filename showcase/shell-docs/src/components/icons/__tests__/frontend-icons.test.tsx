import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import { FrontendLogo } from "../frontend-icons";

describe("FrontendLogo", () => {
  it("renders brand marks for every frontend quickstart surface", () => {
    const rendered = [
      "react",
      "vue",
      "react-native",
      "slack",
      "microsoft-teams",
    ].map((slug) => renderToStaticMarkup(<FrontendLogo slug={slug} />));

    expect(rendered).toHaveLength(5);
    for (const markup of rendered) {
      expect(markup).toContain("<svg");
    }
    expect(rendered.join("\n")).toContain('data-frontend-icon="slack"');
    expect(rendered.join("\n")).toContain(
      'data-frontend-icon="microsoft-teams"',
    );
    expect(rendered.join("\n")).toContain('data-icon-library="react-icons/si"');
    expect(rendered.join("\n")).toContain('data-icon-library="react-icons/tb"');
  });

  it("uses icon library packages instead of inline logo paths", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../frontend-icons.tsx"),
      "utf8",
    );

    expect(source).toContain('from "react-icons/si"');
    expect(source).toContain('from "react-icons/tb"');
    expect(source).not.toContain("<path");
    expect(source).not.toContain("<ellipse");
    expect(source).not.toContain("<circle");
    expect(source).not.toContain("<rect");
  });
});
