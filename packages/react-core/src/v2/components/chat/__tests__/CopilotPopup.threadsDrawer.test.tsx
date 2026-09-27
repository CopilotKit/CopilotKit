/**
 * `threadsDrawer` on `<CopilotPopup>` / `<CopilotSidebar>`: an opt-in threads
 * drawer hosted as an overlay inside the chat modal.
 *
 * - Off (the default) renders exactly what it did before: no launcher, no
 *   drawer.
 * - On, the modal header shows the thread-list launcher at every viewport
 *   width, and it opens the drawer (`overlay` mode) inside the modal.
 * - The drawer's open state is local to the modal: it neither drives a
 *   page-level `<CopilotThreadsDrawer>` nor triggers the mobile modal/drawer
 *   mutual exclusion that would close the modal it lives in.
 */
import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import type { CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement } from "@copilotkit/web-components/threads-drawer";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotPopup } from "../CopilotPopup";
import { CopilotSidebar } from "../CopilotSidebar";
import { CopilotThreadsDrawer } from "../CopilotThreadsDrawer";
import type { ModalThreadsDrawerProp } from "../modal-threads-drawer";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";

const LAUNCHER = "copilot-threads-drawer-launcher";

function Harness({
  surface,
  threadsDrawer,
  pageDrawer = false,
}: {
  surface: "popup" | "sidebar";
  threadsDrawer?: ModalThreadsDrawerProp;
  pageDrawer?: boolean;
}) {
  const agent = React.useMemo(() => new MockStepwiseAgent(), []);
  const Surface = surface === "popup" ? CopilotPopup : CopilotSidebar;
  // A shared, app-level chat configuration (as apps with a page-level drawer
  // use): the page drawer registers with it, so the modal drawer must opt out.
  return (
    <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
      <CopilotChatConfigurationProvider>
        {pageDrawer && <CopilotThreadsDrawer data-testid="page-drawer" />}
        <Surface defaultOpen threadsDrawer={threadsDrawer} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}

/** The drawer hosted inside the modal (not a page-level one). */
function modalDrawer(): CopilotKitThreadsDrawerElement | null {
  return document.querySelector<CopilotKitThreadsDrawerElement>(
    "[data-copilot-popup] copilotkit-threads-drawer, [data-copilot-sidebar] copilotkit-threads-drawer",
  );
}

async function findModalDrawer(): Promise<CopilotKitThreadsDrawerElement> {
  await waitFor(() => expect(modalDrawer()).not.toBeNull());
  return modalDrawer()!;
}

function mockViewport(isMobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("max-width") ? isMobile : !isMobile,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * Lets the lazily-loaded drawer module resolve, so an "absent" assertion can't
 * pass merely because the drawer hadn't loaded yet.
 */
async function settle(ms = 50) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe.each([
  { name: "CopilotPopup", surface: "popup" as const },
  { name: "CopilotSidebar", surface: "sidebar" as const },
])("<$name threadsDrawer>", ({ surface }) => {
  it("is off by default: no launcher and no drawer", async () => {
    render(<Harness surface={surface} />);

    expect(await screen.findByTestId("copilot-modal-header")).toBeTruthy();
    await settle();
    expect(screen.queryByTestId(LAUNCHER)).toBeNull();
    expect(document.querySelector("copilotkit-threads-drawer")).toBeNull();
  });

  it("threadsDrawer={false} renders no launcher and no drawer", async () => {
    render(<Harness surface={surface} threadsDrawer={false} />);

    expect(await screen.findByTestId("copilot-modal-header")).toBeTruthy();
    await settle();
    expect(screen.queryByTestId(LAUNCHER)).toBeNull();
    expect(document.querySelector("copilotkit-threads-drawer")).toBeNull();
  });

  it("shows the launcher on desktop and hosts a closed overlay drawer inside the modal", async () => {
    render(<Harness surface={surface} threadsDrawer />);

    const launcher = await screen.findByTestId(LAUNCHER);
    // Top-left of the header: the launcher leads the header row.
    const header = screen.getByTestId("copilot-modal-header");
    expect(header.contains(launcher)).toBe(true);
    expect(launcher.getAttribute("aria-expanded")).toBe("false");

    const drawer = await findModalDrawer();
    await waitFor(() => expect(drawer.overlay).toBe(true));
    expect(drawer.hasAttribute("overlay")).toBe(true);
    expect(drawer.open).toBe(false);
  });

  it("the launcher opens the drawer; the drawer's own close request closes it", async () => {
    render(<Harness surface={surface} threadsDrawer />);
    const launcher = await screen.findByTestId(LAUNCHER);
    const drawer = await findModalDrawer();

    act(() => {
      fireEvent.click(launcher);
    });
    await waitFor(() => expect(drawer.open).toBe(true));
    expect(launcher.getAttribute("aria-expanded")).toBe("true");

    // The scrim (backdrop) is how a pointer user dismisses it.
    await drawer.updateComplete;
    act(() => {
      drawer.shadowRoot!.querySelector<HTMLElement>(".backdrop")!.click();
    });
    await waitFor(() => expect(drawer.open).toBe(false));
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
  });

  it("moves focus into the drawer on open and back to the launcher on dismiss", async () => {
    render(<Harness surface={surface} threadsDrawer />);
    const launcher = await screen.findByTestId(LAUNCHER);
    const drawer = await findModalDrawer();

    act(() => {
      fireEvent.click(launcher);
    });
    await waitFor(() => expect(drawer.open).toBe(true));
    // Focus inside the shadow root reports the host as activeElement.
    await waitFor(() => expect(document.activeElement).toBe(drawer));

    act(() => {
      drawer
        .shadowRoot!.querySelector<HTMLElement>('[part="close-toggle"]')!
        .click();
    });
    await waitFor(() => expect(drawer.open).toBe(false));
    expect(document.activeElement).toBe(screen.getByTestId(LAUNCHER));
  });

  it("starting a new conversation closes the drawer", async () => {
    render(<Harness surface={surface} threadsDrawer />);
    const launcher = await screen.findByTestId(LAUNCHER);
    const drawer = await findModalDrawer();
    act(() => {
      fireEvent.click(launcher);
    });
    await waitFor(() => expect(drawer.open).toBe(true));
    await drawer.updateComplete;

    act(() => {
      drawer
        .shadowRoot!.querySelector<HTMLElement>('[part="new-thread-button"]')!
        .click();
    });
    await waitFor(() => expect(drawer.open).toBe(false));
  });

  it("Escape outside the drawer closes it without closing the modal", async () => {
    render(<Harness surface={surface} threadsDrawer />);
    const launcher = await screen.findByTestId(LAUNCHER);
    const drawer = await findModalDrawer();
    act(() => {
      fireEvent.click(launcher);
    });
    await waitFor(() => expect(drawer.open).toBe(true));

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await waitFor(() => expect(drawer.open).toBe(false));
    // The modal is still up (the popup only unmounts its window on close;
    // the sidebar marks itself aria-hidden).
    expect(screen.getByTestId("copilot-modal-header")).toBeTruthy();
    if (surface === "sidebar") {
      expect(
        document
          .querySelector("[data-copilot-sidebar]")
          ?.getAttribute("aria-hidden"),
      ).toBe("false");
    }
  });

  it("forwards drawer props from an object value", async () => {
    render(
      <Harness surface={surface} threadsDrawer={{ recentLabel: "History" }} />,
    );
    const drawer = await findModalDrawer();
    expect(drawer.getAttribute("recent-label")).toBe("History");
  });

  it("keeps its open state separate from a page-level drawer", async () => {
    render(<Harness surface={surface} threadsDrawer pageDrawer />);
    const launcher = await screen.findByTestId(LAUNCHER);
    const drawer = await findModalDrawer();
    const pageDrawer = screen.getByTestId(
      "page-drawer",
    ) as unknown as CopilotKitThreadsDrawerElement;

    act(() => {
      fireEvent.click(launcher);
    });
    await waitFor(() => expect(drawer.open).toBe(true));
    expect(pageDrawer.open).toBe(false);
    expect(pageDrawer.overlay).toBe(false);
  });

  it("on mobile, opening the drawer does not close the modal it lives in", async () => {
    mockViewport(true);
    render(<Harness surface={surface} threadsDrawer />);
    const launcher = await screen.findByTestId(LAUNCHER);
    const drawer = await findModalDrawer();

    act(() => {
      fireEvent.click(launcher);
    });
    await waitFor(() => expect(drawer.open).toBe(true));
    // Outlast the popup's 200ms close animation before asserting it stayed.
    await settle(300);
    expect(drawer.open).toBe(true);
    expect(screen.getByTestId(LAUNCHER)).toBeTruthy();
    if (surface === "popup") {
      expect(screen.getByTestId("copilot-popup")).toBeTruthy();
    } else {
      expect(
        document
          .querySelector("[data-copilot-sidebar]")
          ?.getAttribute("aria-hidden"),
      ).toBe("false");
    }
  });
});

describe("<CopilotPopup threadsDrawer> Escape order", () => {
  it("the first Escape closes the drawer, the next closes the popup", async () => {
    render(<Harness surface="popup" threadsDrawer />);
    const launcher = await screen.findByTestId(LAUNCHER);
    const drawer = await findModalDrawer();
    act(() => {
      fireEvent.click(launcher);
    });
    await waitFor(() => expect(drawer.open).toBe(true));

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await waitFor(() => expect(drawer.open).toBe(false));
    expect(screen.getByTestId("copilot-popup")).toBeTruthy();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    // The popup animates out, then unmounts its window.
    await waitFor(() =>
      expect(screen.queryByTestId("copilot-popup")).toBeNull(),
    );
  });
});

describe("page-level drawer without threadsDrawer (unchanged)", () => {
  it("still shows no header launcher on desktop", async () => {
    render(<Harness surface="popup" pageDrawer />);
    expect(await screen.findByTestId("copilot-modal-header")).toBeTruthy();
    await waitFor(() =>
      expect(
        document.querySelector("copilotkit-threads-drawer"),
      ).not.toBeNull(),
    );
    expect(screen.queryByTestId(LAUNCHER)).toBeNull();
    expect(modalDrawer()).toBeNull();
  });
});
