import { describe, expect, it } from "vitest";

import {
  findForbiddenInputs,
  findForbiddenText,
} from "./check-browser-artifact.mjs";

describe("Angular Showcase browser artifact audit", () => {
  it("rejects React module inputs without confusing Preact for React", () => {
    expect(
      findForbiddenInputs([
        "../../node_modules/.pnpm/react@19.2.3/node_modules/react/index.js",
        "../../node_modules/.pnpm/react-dom@19.2.3_react@19.2.3/node_modules/react-dom/client.js",
        "../../node_modules/.pnpm/@preact+signals-core@1.14.1/node_modules/@preact/signals-core/dist/signals.js",
      ]),
    ).toEqual([
      "../../node_modules/.pnpm/react-dom@19.2.3_react@19.2.3/node_modules/react-dom/client.js",
      "../../node_modules/.pnpm/react@19.2.3/node_modules/react/index.js",
    ]);
  });

  it("rejects server routing authority and credential-shaped browser text", () => {
    expect(
      findForbiddenText("main.js", "SHOWCASE_BACKEND_HOST_PATTERN"),
    ).toEqual(["SHOWCASE_BACKEND_HOST_PATTERN"]);
    expect(
      findForbiddenText(
        "main.js",
        "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
      ),
    ).toEqual(["OpenAI credential-shaped value"]);
  });

  it("does not flag ordinary CSS sk-* properties", () => {
    expect(
      findForbiddenText("styles.css", "--sk-position: relative; sk-composite"),
    ).toEqual([]);
  });
});
