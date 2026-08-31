import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CopilotModalHeader } from "../CopilotModalHeader";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../../providers/CopilotChatConfigurationProvider";

/**
 * The in-header launcher is mobile-only (on desktop the drawer is a persistent
 * in-flow panel, so an "open the drawer" launcher there would be a dead no-op).
 * Stub matchMedia so these tests run in a deterministic viewport.
 */
function mockViewport(isMobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isMobile,
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
 * Registers a drawer on mount so the header launcher's presence gate is
 * satisfied. Mirrors what the future <CopilotThreadsDrawer> wrapper does.
 */
function DrawerRegistrar() {
  const config = useCopilotChatConfiguration();
  React.useEffect(() => config?.registerDrawer(), [config]);
  return null;
}

/** Reads the drawer open state for assertions. */
function DrawerStateProbe() {
  const config = useCopilotChatConfiguration();
  return <div data-testid="drawer-state">{String(config?.drawerOpen)}</div>;
}

describe("CopilotModalHeader drawer launcher", () => {
  const originalMatchMedia = window.matchMedia;
  // Default to a mobile viewport so the launcher's presence tests below hold;
  // the desktop case is asserted explicitly.
  beforeEach(() => mockViewport(true));
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("does NOT render the launcher on desktop even when a drawer is registered", () => {
    mockViewport(false);
    render(
      <CopilotChatConfigurationProvider threadId="t">
        <DrawerRegistrar />
        <CopilotModalHeader title="Chat" />
      </CopilotChatConfigurationProvider>,
    );

    expect(screen.queryByTestId("copilot-threads-drawer-launcher")).toBeNull();
  });

  it("does NOT render the launcher when no drawer is registered", () => {
    render(
      <CopilotChatConfigurationProvider threadId="t">
        <CopilotModalHeader title="Chat" />
      </CopilotChatConfigurationProvider>,
    );

    expect(screen.queryByTestId("copilot-threads-drawer-launcher")).toBeNull();
  });

  it("renders the launcher once a drawer registers", () => {
    render(
      <CopilotChatConfigurationProvider threadId="t">
        <DrawerRegistrar />
        <CopilotModalHeader title="Chat" />
      </CopilotChatConfigurationProvider>,
    );

    expect(
      screen.queryByTestId("copilot-threads-drawer-launcher"),
    ).not.toBeNull();
  });

  it("toggles drawerOpen when the launcher is clicked", () => {
    render(
      <CopilotChatConfigurationProvider threadId="t">
        <DrawerRegistrar />
        <CopilotModalHeader title="Chat" />
        <DrawerStateProbe />
      </CopilotChatConfigurationProvider>,
    );

    expect(screen.getByTestId("drawer-state").textContent).toBe("false");

    act(() => {
      fireEvent.click(screen.getByTestId("copilot-threads-drawer-launcher"));
    });
    expect(screen.getByTestId("drawer-state").textContent).toBe("true");

    act(() => {
      fireEvent.click(screen.getByTestId("copilot-threads-drawer-launcher"));
    });
    expect(screen.getByTestId("drawer-state").textContent).toBe("false");
  });

  it("reflects drawer open state via aria-expanded", () => {
    render(
      <CopilotChatConfigurationProvider threadId="t">
        <DrawerRegistrar />
        <CopilotModalHeader title="Chat" />
      </CopilotChatConfigurationProvider>,
    );

    const launcher = screen.getByTestId("copilot-threads-drawer-launcher");
    expect(launcher.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      fireEvent.click(launcher);
    });
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
  });

  it("exposes a stable launcher testid as the focus-return target", () => {
    render(
      <CopilotChatConfigurationProvider threadId="t">
        <DrawerRegistrar />
        <CopilotModalHeader title="Chat" />
      </CopilotChatConfigurationProvider>,
    );

    const launcher = screen.getByTestId("copilot-threads-drawer-launcher");
    act(() => {
      (launcher as HTMLButtonElement).focus();
    });
    expect(document.activeElement).toBe(launcher);
  });

  it("still renders title and close button unchanged when no drawer is present", () => {
    render(
      <CopilotChatConfigurationProvider threadId="t">
        <CopilotModalHeader title="My Chat Header" />
      </CopilotChatConfigurationProvider>,
    );

    expect(screen.getByText("My Chat Header")).toBeDefined();
    expect(document.querySelector('button[aria-label="Close"]')).not.toBeNull();
    expect(screen.queryByTestId("copilot-threads-drawer-launcher")).toBeNull();
  });

  it("passes the nullable drawerLauncher to the children render function", () => {
    let received: React.ReactElement | null | undefined;
    render(
      <CopilotChatConfigurationProvider threadId="t">
        <CopilotModalHeader title="Chat">
          {({ drawerLauncher, titleContent }) => {
            received = drawerLauncher;
            return <div data-testid="custom">{titleContent}</div>;
          }}
        </CopilotModalHeader>
      </CopilotChatConfigurationProvider>,
    );

    // No drawer registered -> launcher payload is null.
    expect(received).toBeNull();
    expect(screen.getByTestId("custom")).toBeDefined();
  });
});
