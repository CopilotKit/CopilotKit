import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const heroStartCommandsSource = readFileSync(
  new URL("../hero-start-commands.tsx", import.meta.url),
  "utf8",
);
const globalsCss = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

// `hero_command_copied` fires alongside the global <CopyTracker>'s
// `cli_command_copied` for the same copy. The sibling records
// `location: window.location.pathname`; this event must carry the same
// dimension so the two are joinable — and because `location` is the only
// surface signal that distinguishes the `onboard` card across the home hero
// and the framework landing heroes (its command is identical everywhere).
// shell-docs vitest runs in the `node` environment with no jsdom/RTL, so this
// asserts the capture shape at the source level, matching the suite's
// convention (see brand-nav.test.tsx).
describe("hero_command_copied analytics", () => {
  it("captures the hero_command_copied event", () => {
    expect(heroStartCommandsSource).toContain(
      'posthog?.capture("hero_command_copied"',
    );
  });

  it("records a location dimension joinable with cli_command_copied", () => {
    expect(heroStartCommandsSource).toContain("location:");
    expect(heroStartCommandsSource).toContain("window.location.pathname");
  });

  it("guards the location read for SSR, mirroring the CopyTracker sibling", () => {
    expect(heroStartCommandsSource).toContain('typeof window !== "undefined"');
  });
});

describe("hero quickstart CTA styling", () => {
  it("opts the primary quickstart link out of prose link colors", () => {
    expect(heroStartCommandsSource).toContain("shell-docs-primary-cta");
    expect(globalsCss).toContain(".reference-content a.shell-docs-primary-cta");
    expect(globalsCss).toContain("color: var(--primary-foreground);");
  });
});
