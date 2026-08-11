import { describe, expect, it, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { useSkinThemeReconcile } from "./use-theme";

function Probe({ vars }: { vars: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  useSkinThemeReconcile(ref);
  return <div ref={ref} style={vars as React.CSSProperties} />;
}

describe("useSkinThemeReconcile", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark", "light");
  });

  it("forces light for a skin that is not dark-capable", () => {
    render(<Probe vars={{}} />);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("applies dark when a dark-capable skin declares --nw-theme-lock: dark", () => {
    render(
      <Probe vars={{ "--nw-dark-capable": "1", "--nw-theme-lock": "dark" }} />,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("keeps a locked skin dark even when light is the stored preference", () => {
    // A light <html> would take the shared chat chrome light while the skin's
    // app card stayed dark — the half-dark mismatch this token prevents.
    localStorage.setItem("theme", "light");
    render(
      <Probe vars={{ "--nw-dark-capable": "1", "--nw-theme-lock": "dark" }} />,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("does not overwrite the user's stored choice when locking", () => {
    localStorage.setItem("theme", "light");
    render(
      <Probe vars={{ "--nw-dark-capable": "1", "--nw-theme-lock": "dark" }} />,
    );
    // Preserved, so switching back to a dual-palette skin restores their choice.
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("still honours a stored preference for a capable skin with no lock declared", () => {
    localStorage.setItem("theme", "dark");
    render(<Probe vars={{ "--nw-dark-capable": "1" }} />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
