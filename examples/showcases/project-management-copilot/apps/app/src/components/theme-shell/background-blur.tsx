"use client";

/**
 * Six large, heavily-blurred colored ellipses — the signature CopilotKit
 * background effect. Coordinates copied verbatim from
 * /Users/jerel-cpk/.claude/skills/copilotkit-ui-theme/references/components.md
 *
 * Place inside a container with position: relative; overflow: hidden.
 * All content cards must have zIndex: 1 to render above.
 */
export function BackgroundBlurCircles() {
  return (
    <>
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 446,
          height: 446,
          left: 1040,
          top: 11,
          borderRadius: "50%",
          background: "rgba(255, 172, 77, 0.2)",
          filter: "blur(103px)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 609,
          height: 609,
          left: 1339,
          top: 625,
          borderRadius: "50%",
          background: "#C9C9DA",
          filter: "blur(103px)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 609,
          height: 609,
          left: 670,
          top: -365,
          borderRadius: "50%",
          background: "#C9C9DA",
          filter: "blur(103px)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 609,
          height: 609,
          left: 508,
          top: 702,
          borderRadius: "50%",
          background: "#F3F3FC",
          filter: "blur(103px)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 446,
          height: 446,
          left: 128,
          top: 331,
          borderRadius: "50%",
          background: "rgba(255, 243, 136, 0.3)",
          filter: "blur(103px)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 446,
          height: 446,
          left: -205,
          top: 803,
          borderRadius: "50%",
          background: "rgba(255, 172, 77, 0.2)",
          filter: "blur(103px)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
    </>
  );
}

interface ThemeShellProps {
  children: React.ReactNode;
}

/**
 * Wrap the entire app body in this. It sets position:relative + overflow:hidden,
 * paints the background blur circles, and renders children at zIndex 1.
 */
export function ThemeShell({ children }: ThemeShellProps) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--surface-main)",
        minHeight: "100svh",
        height: "100dvh",
        width: "100%",
      }}
    >
      <BackgroundBlurCircles />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          height: "100%",
          width: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}
