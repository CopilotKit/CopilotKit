// Shared MDX component registry used by all docs-style pages
// (`/docs/...`, `/<framework>/...`). Pulled out of the docs route so
// the framework-scoped catch-all can reuse the same renderer without
// duplicating 1000+ lines of component shims.

import React from "react";
import Link from "next/link";
import {
  Cards,
  Card,
  Accordions,
  Accordion,
} from "@/components/mdx-components";
import { Callout as DocsCallout } from "@/components/docs-callout";
import { Steps as DocsSteps, Step as DocsStep } from "@/components/docs-steps";
import { Tabs as DocsTabs, Tab as DocsTab } from "@/components/docs-tabs";
import { FrameworkTabs } from "@/components/framework-tabs";
import { PropertyReference } from "@/components/property-reference";
import { getRegistry } from "@/lib/registry";

const Callout = DocsCallout;

// Dev-only warning helper for stub components that discard their props.
// Fires once per component name so HMR / re-renders don't spam the console.
const __warnedStubs = new Set<string>();
function warnStub(name: string, propKeys: string[]): void {
  if (process.env.NODE_ENV === "production") return;
  if (propKeys.length === 0) return;
  const key = `${name}:${propKeys.sort().join(",")}`;
  if (__warnedStubs.has(key)) return;
  __warnedStubs.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[mdx-registry] <${name}> is a non-functional shim — these props were discarded: ${propKeys.join(", ")}. ` +
      `Override <${name}> in the consuming renderer to make it interactive.`,
  );
}

// Wrap a children-only stub so it warns in dev when additional props are
// passed. Keeps runtime behavior identical (render children) for compat.
function stub(name: string) {
  const Stub = ({
    children,
    ...rest
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => {
    const extras = Object.keys(rest);
    if (extras.length > 0) warnStub(name, extras);
    return <div>{children}</div>;
  };
  Stub.displayName = `MdxStub(${name})`;
  return Stub;
}

// Dev-only once-per-key log for silent null returns so MDX authors learn
// their embed didn't render.
const __warnedNull = new Set<string>();
function warnSilentNull(component: string, reason: string): void {
  if (process.env.NODE_ENV === "production") return;
  const key = `${component}:${reason}`;
  if (__warnedNull.has(key)) return;
  __warnedNull.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[mdx-registry] <${component}> rendered nothing — ${reason}`);
}

// Validate a user-supplied URL string destined for an <iframe src>. Only
// https:// URLs are accepted — http is too easy to mix-content-block, and
// `javascript:` / `data:` are an XSS surface even inside a sandboxed
// iframe (some engines still evaluate scripts in the parent for javascript:
// schemes). Returns null when the URL is malformed or non-https, and warns
// in dev so authors notice their embed silently vanished.
function validateIframeSrc(
  component: string,
  src: string | undefined,
): string | null {
  if (!src) return null;
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        `[mdx-registry] <${component}> src is not a valid URL — skipping embed.`,
        { src },
      );
    }
    return null;
  }
  if (parsed.protocol !== "https:") {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        `[mdx-registry] <${component}> src protocol "${parsed.protocol}" is not allowed (expected https:) — skipping embed.`,
        { src },
      );
    }
    return null;
  }
  return parsed.toString();
}

// Detect links that should NOT go through next/link's client-side router.
// next/link is only meaningful for same-origin in-app navigation; using it
// for external URLs (or non-http schemes like mailto:/tel:) either fires a
// spurious prefetch or fails outright. Internal href forms (`/foo`, `#id`,
// `?q=`) are safe for next/link.
function isExternalHref(href: string): boolean {
  if (!href) return false;
  // Protocol-relative URLs (`//example.com/foo`) are external and must not
  // go through next/link. Check this BEFORE the `/`-prefix internal guard.
  if (href.startsWith("//")) return true;
  if (href.startsWith("/") || href.startsWith("#") || href.startsWith("?"))
    return false;
  // Any URL with a scheme that isn't a relative path → treat as external.
  // Covers https://..., http://..., mailto:..., tel:..., ftp:..., etc.
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(href);
}

// Scheme allowlist for MDX-authored hrefs. `javascript:`, `data:`, `vbscript:`,
// `file:`, and any other scheme classify as external via isExternalHref() but
// are live XSS vectors — `rel="noopener noreferrer"` does NOT neutralize them.
// Accept only well-known safe schemes plus relative / protocol-relative /
// fragment / query-only URLs. Anything else → sanitizeHref() returns null and
// callers render text instead of an <a>.
function sanitizeHref(href: string | undefined): string | null {
  if (!href) return null;
  // Relative-ish forms are safe.
  if (
    href.startsWith("/") ||
    href.startsWith("#") ||
    href.startsWith("?") ||
    href.startsWith("//")
  ) {
    return href;
  }
  const schemeMatch = href.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):/);
  if (!schemeMatch) {
    // No scheme → relative path. Safe.
    return href;
  }
  const scheme = schemeMatch[1].toLowerCase();
  if (
    scheme === "http" ||
    scheme === "https" ||
    scheme === "mailto" ||
    scheme === "tel"
  ) {
    return href;
  }
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(
      `[mdx-registry] rejected href with disallowed scheme "${scheme}:" — rendering without link.`,
      { href },
    );
  }
  return null;
}

export const docsComponents = {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
  PropertyReference,
  FeatureIntegrations: ({ feature }: { feature?: string }) => {
    if (!feature) {
      warnSilentNull("FeatureIntegrations", "no `feature` prop provided");
      return null;
    }
    const reg = getRegistry();
    const supporting = reg.integrations.filter(
      (i) => i.deployed && i.features?.includes(feature),
    );
    if (supporting.length === 0) {
      warnSilentNull(
        "FeatureIntegrations",
        `no deployed integrations support feature="${feature}"`,
      );
      if (process.env.NODE_ENV !== "production") {
        return (
          <div className="my-6 rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-xs font-mono text-[var(--text-faint)]">
            [mdx-registry] No deployed integrations support feature &quot;
            {feature}&quot;.
          </div>
        );
      }
      return null;
    }
    return (
      <div className="my-6">
        <div className="text-xs font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
          Supported by
        </div>
        <div className="flex flex-wrap gap-2">
          {supporting.map((i) => (
            <Link
              key={i.slug}
              href={`/integrations/${i.slug}?demo=${feature}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              {i.name}
            </Link>
          ))}
        </div>
      </div>
    );
  },
  InlineDemo: ({
    integration,
    demo,
  }: {
    integration?: string;
    demo?: string;
  }) => {
    if (!integration || !demo) {
      warnSilentNull(
        "InlineDemo",
        `missing required props (integration=${integration ?? "undefined"}, demo=${demo ?? "undefined"})`,
      );
      return null;
    }
    const reg = getRegistry();
    const int = reg.integrations.find((i) => i.slug === integration);
    if (!int || !int.deployed) {
      warnSilentNull(
        "InlineDemo",
        !int
          ? `no integration with slug="${integration}" in registry`
          : `integration "${integration}" is not deployed`,
      );
      return null;
    }
    // Iframe the integration demo directly (its own backend host). The
    // demo-detail page (<integrations/.../[demo]>) is only served by the
    // SHELL host (showcase.copilotkit.ai), so the "Open full demo" link
    // must point at the shell host rather than an in-place relative URL —
    // otherwise it'd 404 on docs.showcase.copilotkit.ai which has no
    // /integrations route.
    const demoUrl = `${int.backend_url}/demos/${demo}`;
    // Validate at the sink even though the registry is trusted today —
    // a malformed backend_url (http://, empty, non-URL) should not silently
    // embed. If validation fails, render a visible error placeholder so
    // authors / operators notice rather than ship a broken/unsafe iframe.
    const safeDemoUrl = validateIframeSrc("InlineDemo", demoUrl);
    const shellHost =
      process.env.NEXT_PUBLIC_SHELL_URL || "https://showcase.copilotkit.ai";
    const profileUrl = `${shellHost}/integrations/${integration}?demo=${demo}`;
    if (!safeDemoUrl) {
      return (
        <div className="my-6 rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-xs font-mono text-[var(--text-faint)]">
          [InlineDemo] Refusing to embed — registry entry for &quot;
          {integration}&quot; has an invalid backend_url.
        </div>
      );
    }
    return (
      <div className="my-6 rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
          <span className="text-xs font-mono text-[var(--text-muted)]">
            Live Demo: {int.name} — {demo}
          </span>
          <a
            href={profileUrl}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Open full demo →
          </a>
        </div>
        {/*
          NOTE on sandbox: we intentionally OMIT `allow-same-origin`. Per MDN,
          combining `allow-scripts` + `allow-same-origin` lets the framed page
          remove its own sandbox attribute — that's a sandbox escape. The
          integration demos are served from a different origin (int.backend_url)
          than the docs host, so they do not need same-origin semantics to
          function (no shared cookies / storage / DOM access with the parent).
          Keep forms + popups so the demo can still submit / open new tabs.
        */}
        <iframe
          src={safeDemoUrl}
          className="w-full"
          style={{ height: "500px" }}
          sandbox="allow-scripts allow-forms allow-popups"
          loading="lazy"
        />
      </div>
    );
  },
  Note: Callout,
  Warning: ({ children }: { children: React.ReactNode }) => (
    <Callout type="warn">{children}</Callout>
  ),
  Tip: ({ children }: { children: React.ReactNode }) => (
    <Callout type="info">{children}</Callout>
  ),
  ThreadsEarlyAccess: ({ children }: { children: React.ReactNode }) => (
    <>
      <Callout type="info">
        <strong>Early access:</strong> Threads and the Intelligence Platform are
        in early access. APIs may change before general availability.
      </Callout>
      {children}
    </>
  ),
  Steps: DocsSteps,
  Step: DocsStep,
  CardGroup: Cards,
  Tabs: DocsTabs,
  Tab: DocsTab,
  FrameworkTabs,
  Frame: ({ children }: { children: React.ReactNode }) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "1rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  IntegrationGrid: ({ path }: { path?: string }) => (
    <div
      style={{
        padding: "1rem",
        background: "var(--bg-elevated)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
        fontSize: "0.875rem",
        color: "var(--text-muted)",
      }}
    >
      See{" "}
      <a href="/integrations" style={{ color: "var(--accent)" }}>
        Integrations
      </a>{" "}
      for all available frameworks{path ? ` (${path})` : ""}.
    </div>
  ),
  FeatureGrid: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
      }}
    >
      {children}
    </div>
  ),
  Feature: ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title?: string;
  }) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "1rem",
      }}
    >
      {title && (
        <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>
      )}
      {children}
    </div>
  ),
  video: (props: Record<string, unknown>) => {
    // Accept user className from MDX — prior impl spread className in then
    // immediately overrode it to `undefined`, silently dropping it.
    // Merge author-provided `style` so we preserve author keys while still
    // enforcing our layout defaults (maxWidth etc.) last.
    const authorStyle =
      typeof props.style === "object" && props.style !== null
        ? (props.style as React.CSSProperties)
        : {};
    return (
      <video
        {...props}
        style={{
          ...authorStyle,
          borderRadius: "0.5rem",
          width: "100%",
          marginBottom: "1rem",
        }}
      />
    );
  },
  img: (props: Record<string, unknown>) => {
    // Accept user className from MDX (see note on `video` above). Merge
    // author `style` before our defaults so our layout guards still win.
    const authorStyle =
      typeof props.style === "object" && props.style !== null
        ? (props.style as React.CSSProperties)
        : {};
    return (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img
        {...props}
        style={{
          ...authorStyle,
          borderRadius: "0.5rem",
          maxWidth: "100%",
          marginBottom: "1rem",
        }}
      />
    );
  },
  CodeGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Snippet: ({ children }: { children?: React.ReactNode }) => {
    // DocsPageView overrides this at consumer sites. If the base registry
    // is used directly without override, surface a visible dev-mode hint
    // so authors notice their Snippet isn't rendering real content.
    if (process.env.NODE_ENV !== "production") {
      warnSilentNull("Snippet", "runtime override required (base stub)");
      return (
        <div className="my-4 rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-xs font-mono text-[var(--text-faint)]">
          [Snippet] runtime override required
          {children ? <div className="mt-1">{children}</div> : null}
        </div>
      );
    }
    return <div>{children}</div>;
  },
  Info: Callout,
  Caution: ({ children }: { children: React.ReactNode }) => (
    <Callout type="warn">{children}</Callout>
  ),
  TailoredContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TailoredContentOption: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SharedContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IframeSwitcher: ({
    children,
    src,
    title,
  }: {
    children?: React.ReactNode;
    src?: string;
    title?: string;
  }) => {
    const safeSrc = validateIframeSrc("IframeSwitcher", src);
    if (!safeSrc) return <div>{children}</div>;
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "0.5rem",
          overflow: "hidden",
          marginBottom: "1rem",
        }}
      >
        {/*
          Sandbox: drop `allow-same-origin`. Combining it with `allow-scripts`
          lets the framed page remove its own sandbox attribute (MDN). This
          component embeds arbitrary MDX-author-supplied URLs — it is NOT
          trusted content — so defense-in-depth is mandatory. Keep forms +
          popups for parity with typical embedded content (StackBlitz etc.).
        */}
        <iframe
          src={safeSrc}
          title={title || "Embedded content"}
          style={{ width: "100%", height: "400px", border: "none" }}
          sandbox="allow-scripts allow-forms allow-popups"
          loading="lazy"
        />
      </div>
    );
  },
  IframeSwitcherGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RunAndConnect: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RunAndConnectSnippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MigrateTo: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MigrateToV: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  HeadlessUI: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ImageZoom: ({ src, alt }: { src?: string; alt?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || ""}
      style={{
        borderRadius: "0.5rem",
        maxWidth: "100%",
        marginBottom: "1rem",
        cursor: "zoom-in",
      }}
    />
  ),
  InstallSDKSnippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MCPApps: stub("MCPApps"),
  MCPSetup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Overview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrameworkOverview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommonIssues: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ErrorDebugging: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Observability: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ObservabilityConnectors: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Inspector: stub("Inspector"),
  DefaultToolRendering: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DisplayOnly: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Interactive: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PrebuiltComponents: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ProgrammaticControl: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CodingAgents: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CustomAgent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DebugMode: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  NewLookAndFeelPreview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Slots: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrontendTools: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrontEndToolsImpl: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolRendering: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolRenderer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ReasoningMessages: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  YouTubeVideo: ({ id, title }: { id?: string; title?: string }) => {
    // YouTube video IDs are 11 chars of [A-Za-z0-9_-]. Accept only that
    // shape — anything else either traversal-injects query params into
    // the embed URL or points at some non-YouTube origin.
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
      if (id && process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          "[mdx-registry] <YouTubeVideo> invalid id — skipping embed.",
          { id },
        );
      }
      return null;
    }
    const src = validateIframeSrc(
      "YouTubeVideo",
      `https://www.youtube.com/embed/${id}`,
    );
    if (!src) return null;
    return (
      <div
        style={{
          position: "relative",
          paddingBottom: "56.25%",
          marginBottom: "1rem",
        }}
      >
        {/*
          Sandbox: drop `allow-same-origin`. YouTube is trusted content, but
          the `allow-scripts` + `allow-same-origin` combination lets the
          framed page escape its sandbox regardless of origin trust — pure
          defense-in-depth loss. YouTube's embed player works without
          same-origin access to the parent. Keep presentation + popups.
        */}
        <iframe
          src={src}
          title={title || "YouTube video"}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: "0.5rem",
          }}
          sandbox="allow-scripts allow-presentation allow-popups"
          loading="lazy"
          allowFullScreen
        />
      </div>
    );
  },
  CTACards: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  AttributeCards: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  PatternCard: ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title?: string;
  }) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "1rem",
        marginBottom: "0.75rem",
      }}
    >
      {title && (
        <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>
      )}
      {children}
    </div>
  ),
  TwoColumnSection: ({ children }: { children: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "1.5rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  EcosystemTable: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FeatureMatrix: () => (
    <div
      style={{
        padding: "1rem",
        background: "var(--bg-elevated)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      See the{" "}
      <a href="/matrix" style={{ color: "var(--accent)" }}>
        Feature Matrix
      </a>{" "}
      for a full comparison.
    </div>
  ),
  IntegrationsGrid: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IntegrationButtonGroup: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  AGUI: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  AgUI: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  SignUpSection: () => (
    <div
      style={{
        padding: "1rem",
        background: "var(--bg-elevated)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      <a href="https://cloud.copilotkit.ai" style={{ color: "var(--accent)" }}>
        Sign up for CopilotKit Cloud →
      </a>
    </div>
  ),
  LinkToCopilotCloud: () => (
    <a href="https://cloud.copilotkit.ai" style={{ color: "var(--accent)" }}>
      CopilotKit Cloud
    </a>
  ),
  LandingCodeShowcase: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  UseAgentSnippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  InstallPythonSDK: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ActionButtons: ({ children }: { children?: React.ReactNode }) => (
    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
      {children}
    </div>
  ),
  ApproveComponent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AskComponent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotCloudConfigureCopilotKitProvider: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>,
  GenerativeUISpecsOverview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IOptions: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  JsonOptions: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageActionRenderProps: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotRuntime: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Image: ({ src, alt }: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src as string}
      alt={(alt as string) || ""}
      style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem" }}
    />
  ),
  A: ({ children, href }: { children?: React.ReactNode; href?: string }) => {
    const safe = sanitizeHref(href);
    if (!safe) {
      // Strip the href entirely — rendering as text avoids the XSS vector
      // while preserving the author's visible content.
      return <span style={{ color: "var(--accent)" }}>{children}</span>;
    }
    return (
      <a href={safe} style={{ color: "var(--accent)" }}>
        {children}
      </a>
    );
  },
  Button: ({
    children,
    onClick,
    type,
    disabled,
    "aria-label": ariaLabel,
  }: {
    children?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    "aria-label"?: string;
  }) => {
    if (process.env.NODE_ENV !== "production" && !onClick) {
      // eslint-disable-next-line no-console
      console.warn(
        "[mdx-registry] <Button> rendered without onClick — this is a non-interactive stub. If interactivity is required, wire it up in the consuming MDX renderer.",
      );
    }
    return (
      <button
        // Default to type="button" so a Button inside a <form> (rare in
        // MDX, but possible) does not trigger a submit.
        type={type ?? "button"}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          cursor: "pointer",
        }}
      >
        {children}
      </button>
    );
  },
  Link: ({
    children,
    href,
    ...rest
  }: {
    children?: React.ReactNode;
    href?: string;
    [key: string]: unknown;
  }) => {
    if (!href) {
      return <a {...(rest as Record<string, unknown>)}>{children}</a>;
    }
    // Scheme allowlist: reject `javascript:`, `data:`, `vbscript:`, etc. These
    // match the external-href branch (scheme with `:`) but `rel="noopener"`
    // does NOT neutralize script-URL schemes. Strip the href entirely.
    const safeHref = sanitizeHref(href);
    if (!safeHref) {
      return <span {...(rest as Record<string, unknown>)}>{children}</span>;
    }
    // External hrefs (https://..., mailto:..., etc.) must NOT use next/link —
    // next/link is client-router-only and spuriously prefetches external
    // URLs. Internal forms (`/foo`, `#id`, `?q=`) route through next/link for
    // client-side navigation. Add rel/target on external links so they don't
    // leak the opener reference + open in a new tab by default.
    if (isExternalHref(safeHref)) {
      const extraProps = rest as Record<string, unknown>;
      // Put the spread first so caller-supplied target/rel win; fall back
      // to safe defaults (_blank + noopener noreferrer) only when absent.
      return (
        <a
          {...extraProps}
          href={safeHref}
          target={(extraProps.target as string) ?? "_blank"}
          rel={(extraProps.rel as string) ?? "noopener noreferrer"}
        >
          {children}
        </a>
      );
    }
    return (
      <Link href={safeHref} {...(rest as Record<string, unknown>)}>
        {children}
      </Link>
    );
  },
  Code: ({ children }: { children?: React.ReactNode }) => (
    <code>{children}</code>
  ),
  Progress: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // Lucide icons
  Wrench: () => <span>🔧</span>,
  WrenchIcon: () => <span>🔧</span>,
  PaintbrushIcon: () => <span>🎨</span>,
  UserIcon: () => <span>👤</span>,
  RepeatIcon: () => <span>🔄</span>,
  Book: () => <span>📖</span>,
  BookOpen: () => <span>📖</span>,
  BookA: () => <span>📖</span>,
  Bot: () => <span>🤖</span>,
  Cpu: () => <span>💻</span>,
  CpuIcon: () => <span>💻</span>,
  Database: () => <span>🗄️</span>,
  FileSpreadsheet: () => <span>📊</span>,
  Layers: () => <span>📚</span>,
  MessageCircle: () => <span>💬</span>,
  MessageSquare: () => <span>💬</span>,
  MessageSquareMore: () => <span>💬</span>,
  Network: () => <span>🕸️</span>,
  Newspaper: () => <span>📰</span>,
  MonitorIcon: () => <span>🖥️</span>,
  Plane: () => <span>✈️</span>,
  Play: () => <span>▶️</span>,
  Plug: () => <span>🔌</span>,
  PlugIcon: () => <span>🔌</span>,
  Settings: () => <span>⚙️</span>,
  Sparkles: () => <span>✨</span>,
  SquareChartGantt: () => <span>📊</span>,
  SquareTerminal: () => <span>💻</span>,
  Trash: () => <span>🗑️</span>,
  Zap: () => <span>⚡</span>,
  X: () => <span>✕</span>,
  Cog: () => <span>⚙️</span>,
  Server: () => <span>🖥️</span>,
  ArrowLeftRight: () => <span>↔️</span>,
  Banknote: () => <span>💰</span>,
  AlertCircle: () => <span>⚠️</span>,
  PiMonitor: () => <span>🖥️</span>,
  AwsStrandsIcon: () => <span>☁️</span>,
  MicrosoftIcon: () => <span>Ⓜ️</span>,
  PydanticAIIcon: () => <span>🐍</span>,
  SiLangchain: () => <span>🔗</span>,
  FaArrowUp: () => <span>↑</span>,
  FaCloud: () => <span>☁️</span>,
  FaGithub: () => <span>⌨️</span>,
  FaServer: () => <span>🖥️</span>,
  FaWrench: () => <span>🔧</span>,
  CopilotKit: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotChat: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotSidebar: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotPopup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotTextarea: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotKitProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotUI: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CloudCopilotKitProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelfHostingCopilotRuntimeCreateEndpoint: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>,
  SelfHostingCopilotRuntimeConfigureCopilotKitProvider: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>,
  AgentState: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AgentStateSnapshot: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AgentRunResponseUpdate: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // Radix-style <Tooltip content=... label=...> props would be silently
  // dropped by a plain children-only shim. Route through stub() so dev-mode
  // gets a one-shot warning listing the discarded prop names.
  Tooltip: stub("Tooltip"),
  TooltipProvider: stub("TooltipProvider"),
  Markdown: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Chat: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Task: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TasksList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TasksProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MapCanvas: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Email: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  EmailsProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  EmailThread: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ChatMessage: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageFromA: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageToA: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Reply: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PlaceCard: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Proposal: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ProposalViewer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TripsProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchContext: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchContextType: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchState: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SearchInfo: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SearchProgress: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  YourApp: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  YourMainContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MCPClient: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  McpServerManager: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  McpToolCall: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  GoServer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
};
