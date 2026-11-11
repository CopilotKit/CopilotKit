import React, { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  A2UIProvider,
  useA2UIActions,
  useA2UIError,
} from "../core/A2UIProvider";
import { A2UIRenderer } from "../core/A2UIRenderer";

function mount(
  component: Record<string, unknown>,
  data: Record<string, unknown> = {},
  version = "1.0",
) {
  let actions!: ReturnType<typeof useA2UIActions>;
  function Surface() {
    actions = useA2UIActions();
    const error = useA2UIError();
    useEffect(() => {
      actions.processMessages([
        {
          version,
          createSurface: {
            surfaceId: "s",
            catalogId:
              version === "1.0"
                ? "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
                : "https://a2ui.org/specification/v0_9/basic_catalog.json",
          },
        },
        {
          version,
          updateComponents: {
            surfaceId: "s",
            components: [{ id: "root", ...component }],
          },
        },
        { version, updateDataModel: { surfaceId: "s", value: data } },
      ]);
    }, []);
    return (
      <>
        {error && <div role="alert">{error}</div>}
        <A2UIRenderer surfaceId="s" />
      </>
    );
  }
  const view = render(
    <A2UIProvider>
      <Surface />
    </A2UIProvider>,
  );
  return { ...view, actions };
}

describe("native 1.0 basic visual properties", () => {
  it.each(["shortText", "longText"])(
    "updates a bound %s field placeholder",
    (variant) => {
      const view = mount(
        {
          component: "TextField",
          label: "Name",
          variant,
          value: "",
          placeholder: { "@path": "/hint" },
        },
        { hint: "Enter your name" },
      );
      const field = view.getByPlaceholderText("Enter your name");
      expect(field.tagName).toBe(variant === "longText" ? "TEXTAREA" : "INPUT");
      expect(view.queryByRole("alert")).toBeNull();
      act(() => {
        view.actions.processMessages([
          {
            version: "1.0",
            updateDataModel: {
              surfaceId: "s",
              path: "/hint",
              value: "New hint",
            },
          },
        ]);
      });
      expect(view.getByPlaceholderText("New hint")).toBe(field);
    },
  );

  it("treats slider steps as divisions of the range and updates in place", () => {
    const slider = {
      component: "Slider",
      min: 10,
      max: 40,
      value: 20,
      steps: 3,
    };
    const view = mount(slider);
    const input = view.getByRole("slider");
    expect(view.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("step")).toBe("10");
    act(() => {
      view.actions.processMessages([
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "s",
            components: [{ id: "root", ...slider, steps: 6 }],
          },
        },
      ]);
    });
    expect(view.getByRole("slider")).toBe(input);
    expect(input.getAttribute("step")).toBe("5");
  });

  it("leaves the legacy slider's browser step default unchanged", () => {
    const view = mount(
      { component: "Slider", min: 10, max: 40, value: 20 },
      {},
      "v0.9",
    );
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByRole("slider").hasAttribute("step")).toBe(false);
  });

  it("keeps native sliders continuous when divisions are omitted", () => {
    const view = mount({ component: "Slider", min: 0, max: 1, value: 0.5 });
    const input = view.getByRole("slider") as HTMLInputElement;
    expect(view.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("step")).toBe("any");
    expect(input.validity.stepMismatch).toBe(false);
  });

  it("updates the video's bound poster without replacing the video", () => {
    const view = mount(
      {
        component: "Video",
        url: "https://example.com/movie.mp4",
        posterUrl: { "@path": "/poster" },
      },
      { poster: "https://example.com/before.png" },
    );
    const video = view.container.querySelector("video");
    expect(view.queryByRole("alert")).toBeNull();
    expect(video?.getAttribute("poster")).toBe(
      "https://example.com/before.png",
    );
    act(() => {
      view.actions.processMessages([
        {
          version: "1.0",
          updateDataModel: {
            surfaceId: "s",
            path: "/poster",
            value: "https://example.com/after.png",
          },
        },
      ]);
    });
    expect(view.container.querySelector("video")).toBe(video);
    expect(video?.getAttribute("poster")).toBe("https://example.com/after.png");
    act(() => {
      view.actions.processMessages([
        {
          version: "1.0",
          updateDataModel: {
            surfaceId: "s",
            path: "/poster",
            value: "javascript:alert('blocked')",
          },
        },
      ]);
    });
    expect(video?.hasAttribute("poster")).toBe(false);
  });
});
