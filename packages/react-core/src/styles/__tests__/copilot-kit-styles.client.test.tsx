import React from "react";
import { render } from "@testing-library/react";
import { stylesheet } from "@copilotkit/core/styles";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotChat } from "../../components/chat/CopilotChat";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
} from "../../__tests__/utils/test-helpers";
import { CopilotKitStyles } from "../copilot-kit-styles";

const isReact19 = Number.parseInt(React.version, 10) >= 19;

/** The CopilotKit style tags: hoisted into <head> on React 19, in place on 18. */
function copilotKitStyles(): HTMLStyleElement[] {
  return [...document.querySelectorAll("style")].filter(
    (style) => style.textContent === stylesheet,
  );
}

describe("CopilotKitStyles in the browser", () => {
  it.runIf(isReact19)(
    "adds one copy of the stylesheet to document.head",
    () => {
      render(
        <>
          <CopilotKitStyles />
          <CopilotKitStyles />
        </>,
      );

      const styles = document.head.querySelectorAll(
        'style[data-href="copilotkit"]',
      );
      expect(styles).toHaveLength(1);
      expect(styles[0]!.textContent).toContain(".cpk-suggestion-pill)");
      expect(document.body.querySelectorAll("style")).toHaveLength(0);
    },
  );

  it.skipIf(isReact19)("renders the stylesheet in place on React 18", () => {
    const { container } = render(<CopilotKitStyles />);

    const styles = container.querySelectorAll("style");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(stylesheet);
    expect(styles[0]!.attributes).toHaveLength(0);
  });

  it("is rendered by CopilotChat, so apps don't import a stylesheet", () => {
    renderWithCopilotKit({
      agent: new MockStepwiseAgent(),
      children: <CopilotChat welcomeScreen={false} />,
    });

    expect(copilotKitStyles()).toHaveLength(1);
  });
});

interface StyleProbe {
  /** Whether CopilotKit's stylesheet was in the page when the probe ran. */
  stylesheetInPage: boolean;
}

/**
 * Records each time the page's style probe is read. The stub reports a probe
 * without CopilotKit's styles, so core never marks the document as checked and
 * every test sees its own reads. Core's tests cover what the probe reports.
 */
function recordStyleProbes() {
  const probes: StyleProbe[] = [];
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    if (!element.matches("[data-copilotkit-style-probe]")) {
      return realGetComputedStyle(element);
    }
    probes.push({ stylesheetInPage: copilotKitStyles().length > 0 });
    return document.createElement("div").style;
  });
  return probes;
}

describe("CopilotKitStyles style override check", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("checks the page in development, after the stylesheet is in it", () => {
    vi.stubEnv("NODE_ENV", "development");
    const probes = recordStyleProbes();

    render(<CopilotKitStyles />);

    expect(probes).toEqual([{ stylesheetInPage: true }]);
  });

  it("does not check the page in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const probes = recordStyleProbes();

    render(<CopilotKitStyles />);

    expect(probes).toEqual([]);
  });

  it("does not check the page when the app loads styles.css itself", () => {
    vi.stubEnv("NODE_ENV", "development");
    const probes = recordStyleProbes();

    renderWithCopilotKit({
      injectStyles: false,
      children: <CopilotKitStyles />,
    });

    expect(probes).toEqual([]);
  });
});
