import React, { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  A2UIProvider,
  useA2UIActions,
  useA2UIError,
} from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";

/** Render one Text surface and retain its actions for data-model updates. */
function mountText(
  text: string | Record<string, string>,
  version = "1.0",
  variant = "body",
  data: Record<string, unknown> = {},
) {
  let actions!: ReturnType<typeof useA2UIActions>;
  function Surface() {
    actions = useA2UIActions();
    const { processMessages } = actions;
    const error = useA2UIError();
    useEffect(() => {
      processMessages([
        {
          version,
          createSurface: {
            surfaceId: "text",
            catalogId:
              version === "1.0"
                ? "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
                : "https://a2ui.org/specification/v0_9/basic_catalog.json",
          },
        },
        {
          version,
          updateComponents: {
            surfaceId: "text",
            components: [{ id: "root", component: "Text", text, variant }],
          },
        },
        { version, updateDataModel: { surfaceId: "text", value: data } },
      ]);
    }, [processMessages]);
    return (
      <>
        {error && <div role="alert">{error}</div>}
        <A2UIRenderer surfaceId="text" />
      </>
    );
  }
  const view = render(
    <A2UIProvider>
      <Surface />
    </A2UIProvider>,
  );
  expect(view.queryByRole("alert")).toBeNull();
  return { ...view, actions };
}

describe("native Text formatting", () => {
  it.each([1, 2, 3, 4, 5, 6])(
    "renders level %s Markdown headings as semantic headings",
    (level) => {
      const view = mountText(`${"#".repeat(level)} Heading`);
      const heading = view.getByRole("heading", { name: "Heading", level });
      expect(heading.closest("span, p")).toBeNull();
    },
  );

  it("renders emphasis and strong emphasis while preserving the plain body host", () => {
    const view = mountText("A *small* and **important** message");
    expect(view.getByText("small").tagName).toBe("EM");
    expect(view.getByText("important").tagName).toBe("STRONG");
    expect(view.getByText("small").parentElement?.tagName).toBe("SPAN");
  });

  it("updates formatting when bound text changes", () => {
    const view = mountText({ "@path": "/message" }, "1.0", "body", {
      message: "# First",
    });
    expect(view.getByRole("heading", { name: "First", level: 1 })).toBeTruthy();
    act(() => {
      view.actions.processMessages([
        {
          version: "1.0",
          updateDataModel: {
            surfaceId: "text",
            value: { message: "## Updated **heading**" },
          },
        },
      ]);
    });
    expect(view.queryByRole("heading", { name: "First" })).toBeNull();
    expect(
      view.getByRole("heading", { name: "Updated heading", level: 2 }),
    ).toBeTruthy();
    expect(view.getByText("heading").tagName).toBe("STRONG");
  });

  it("renders a bound numeric zero as native body text", () => {
    const view = mountText({ "@path": "/message" }, "1.0", "body", {
      message: 0,
    });
    expect(view.getByText("0").tagName).toBe("SPAN");
  });

  it("keeps HTML literal instead of creating elements or event handlers", () => {
    const text =
      '<img src="https://example.com/image" onerror="alert(1)"> <script>alert(1)</script>';
    const view = mountText(text);
    expect(view.container.textContent).toBe(text);
    expect(view.container.querySelector("img, script, [onerror]")).toBeNull();
  });

  it("keeps links, images, and autolinks inert", () => {
    const text =
      "[link](https://example.com) ![image](https://example.com/image) <https://example.com> https://example.com";
    const view = mountText(text);
    expect(view.container.textContent).toBe(text);
    expect(view.container.querySelector("a, img, [href], [src]")).toBeNull();
  });

  it("keeps plain body Text in its existing span", () => {
    const view = mountText("Plain message");
    expect(view.getByText("Plain message").tagName).toBe("SPAN");
  });

  it.each(["Tom & Jerry", 'Say "hello"', "Don't stop"])(
    "preserves source punctuation in %s",
    /** Keep React text literal instead of displaying the lexer's HTML entities. */
    (text) => {
      const view = mountText(text);
      expect(view.container.textContent).toBe(text);
    },
  );
});

describe("existing Text behavior", () => {
  it.each([1, 2, 3, 4, 5])("preserves the legacy h%s variant", (level) => {
    const view = mountText("*Literal heading*", "v0.9", `h${level}`);
    expect(view.getByRole("heading", { level }).textContent).toBe(
      "*Literal heading*",
    );
    expect(view.container.querySelector("em")).toBeNull();
  });

  it("preserves literal legacy body text", () => {
    const text = "# Heading with **literal** formatting";
    const view = mountText(text, "v0.9");
    expect(view.getByText(text).tagName).toBe("SPAN");
    expect(view.container.querySelector("h1, strong")).toBeNull();
  });

  it.each(["1.0", "v0.9"])("preserves literal %s captions", (version) => {
    const text = "# Caption with *literal* formatting";
    const view = mountText(text, version, "caption");
    expect(view.getByText(text).tagName).toBe("SMALL");
    expect(view.container.querySelector("h1, em")).toBeNull();
  });
});
