"use client";
import { use, useEffect } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  CopilotKitProvider,
  CopilotChatConfigurationProvider,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import type { ReactActivityMessageRenderer } from "@copilotkit/react-core/v2";
import type { Skin } from "@/shell/skin-contract";
import { getSkin } from "@/shell/registry";
import { isSkinLockedOut, useLockedSkin } from "@/shell/locked-skin-context";
import { SkinProvider } from "@/shell/skin-provider";
import { ShellFrame } from "@/shell/layout/shell-frame";
import { LayoutPreferencesProvider } from "@/shell/layout/layout-preferences";
import { ChatPanel } from "@/shell/chat/chat-panel";
import { ChatInboxProvider } from "@/shell/chat/chat-inbox-context";
import { TOOL_CALL_RENDERERS } from "@/shell/chat/tool-activity";
import { CanvasProvider } from "@/shell/canvas/canvas-context";
import { SubagentActivityProvider } from "@/shell/subagents/subagent-activity";
import { CanvasRegion } from "@/shell/canvas/canvas";
import { useThreadSelection } from "@/shell/threads/use-thread-selection";
import {
  blockSurfaceIdFrom,
  InlineBlockSurface,
} from "@/shell/chat/inline-block-surface";

/**
 * The agent's render_report result becomes an `a2ui-surface` activity that the
 * shared canvas renders full-region; generateSandboxedUi becomes an
 * `open-generative-ui` activity that ALSO renders full-region on the canvas
 * (this build ships the workspace OGUI renderer). In the chat we leave only a
 * small handoff pill in place of each built-in inline surface renderer —
 * EXCEPT for a `block:`-prefixed surface id, the exec skin's convention for a
 * block dashboard tile that should render right in the transcript instead of
 * handing off to the canvas. `blockSurfaceIdFrom` (shared with the exec skin's
 * op-builder by hand, see that module's comment) recognizes the convention;
 * any other `a2ui-surface` id falls back to the same handoff pill as before.
 */
function A2UISurfaceActivity(props: { content: unknown }) {
  const surfaceId = blockSurfaceIdFrom(props.content);
  if (surfaceId) return <InlineBlockSurface content={props.content} />;
  return <ReportHandoffPill />;
}

function ReportHandoffPill() {
  return (
    <div className="my-1.5 inline-flex max-w-fit items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-2 text-xs font-medium text-ink">
      <span className="h-2 w-2 rounded-full bg-brand" />
      <span className="uppercase tracking-wide text-ink-muted">report</span>
      <span aria-hidden className="text-ink-muted">
        →
      </span>
      <span>rendered on the canvas</span>
    </div>
  );
}

function OguiHandoffPill() {
  return (
    <div className="my-1.5 inline-flex max-w-fit items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-2 text-xs font-medium text-ink">
      <span className="h-2 w-2 rounded-full bg-brand" />
      <span className="uppercase tracking-wide text-ink-muted">
        interactive
      </span>
      <span aria-hidden className="text-ink-muted">
        →
      </span>
      <span>rendered on the canvas</span>
    </div>
  );
}

/**
 * Module-level so the array reference stays stable across renders
 * (CopilotKitProvider requires a stable renderActivityMessages array). Both
 * activity types are handled here — the OGUI pill is not dropped.
 */
const A2UI_RENDERERS: ReactActivityMessageRenderer<unknown>[] = [
  {
    activityType: "a2ui-surface",
    content: z.any(),
    render: A2UISurfaceActivity,
  },
  {
    activityType: "open-generative-ui",
    content: z.any(),
    render: OguiHandoffPill,
  },
];

function SkinSuggestions({ skin }: { skin: Skin }) {
  useConfigureSuggestions({
    available: "always",
    suggestions: skin.suggestions,
  });
  return null;
}

// Module-level passthrough so a skin without a Providers stack doesn't create a
// new component during render (react-hooks/static-components).
function PassThrough({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * Render the skin's emoji `identity.favicon` into a `<link rel="icon">` so each
 * skin owns its browser-tab icon (e.g. /airline → ✈️). Client-side because the
 * per-skin layout is a client component (Next's metadata API is server-only).
 * Restores the app's static favicon.ico on unmount / when a skin omits one, so
 * navigating away from a skin doesn't strand its emoji.
 */
function FaviconSync({ emoji }: { emoji?: string }) {
  useEffect(() => {
    if (!emoji) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    // Next injects a `<link rel="icon">` from the app/favicon.ico convention;
    // create one only if that is somehow absent.
    const created = !link;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    const previousHref = link.href;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${emoji}</text></svg>`;
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    return () => {
      if (created) link.remove();
      else link.href = previousHref;
    };
  }, [emoji]);
  return null;
}

/**
 * The per-skin runtime subtree. Mounted with key={skin.id} by SkinLayout, so
 * switching skins fully remounts the CopilotKit provider + a fresh thread —
 * each skin runs in its own clean world.
 *
 * `RuntimeProviders` (optional) mounts ABOVE `CopilotKitProvider` so a skin can
 * establish the context its `useRuntimeProperties` hook reads. The provider
 * subtree itself lives in `SkinCopilotRuntime`, a child of `RuntimeProviders`.
 */
function SkinRuntime({
  skin,
  children,
}: {
  skin: Skin;
  children: React.ReactNode;
}) {
  const RuntimeProviders = skin.RuntimeProviders ?? PassThrough;
  // The locked tab title is set on the server in the root layout's
  // generateMetadata (keyed on LOCK_SKIN), so SSR/crawlers see the brand. Only
  // the per-skin favicon is swapped client-side below, since Next's metadata
  // API is server-only and this per-skin layout is a client component.
  return (
    <div className={skin.themeClass}>
      <FaviconSync emoji={skin.identity.favicon} />
      <RuntimeProviders>
        <SkinCopilotRuntime skin={skin}>{children}</SkinCopilotRuntime>
      </RuntimeProviders>
    </div>
  );
}

/**
 * The CopilotKit provider subtree for a skin. Split out of `SkinRuntime` so it
 * renders BELOW `skin.RuntimeProviders` — that is what lets `useRuntimeProperties`
 * read a skin's above-provider context (e.g. banking's auth) and have the shell
 * thread the result straight into `CopilotKitProvider`'s `properties` prop. The
 * provider then OWNS the property bag from its first commit; no child races an
 * imperative `setProperties`, so client identity is ordering-independent.
 */
function SkinCopilotRuntime({
  skin,
  children,
}: {
  skin: Skin;
  children: React.ReactNode;
}) {
  const { threadId, selectThread, createThread } = useThreadSelection();

  // Skin-contributed runtime properties (identity scoping). The skin is fixed for
  // this subtree's lifetime (keyed remount on skin change), so the optional hook
  // call is order-stable. Undefined when a skin contributes none.
  const properties = skin.useRuntimeProperties?.();

  const Providers = skin.Providers ?? PassThrough;
  const Layout = skin.Layout;
  const Tools = skin.Tools;

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      // The runtime route is the multi-endpoint REST handler; the
      // single-endpoint transport 404s against it, so stay in REST mode.
      useSingleEndpoint={false}
      // Provider-OWNED identity: a skin's `useRuntimeProperties` result flows
      // straight in here, so the runtime's per-user Intelligence scoping never
      // depends on a child effect firing in the right order. The provider adds
      // `a2uiCatalogAvailable` itself, so a skin need not set it.
      properties={properties}
      a2ui={{ catalog: skin.catalog }}
      // Replace the built-in inline surface renderers with small handoff pills
      // (report + OGUI both render full-region on the shared canvas).
      renderActivityMessages={A2UI_RENDERERS}
      // Wildcard tool-call chip: a visible activity line for every tool call
      // with no richer renderer of its own — this is what makes the agent's
      // tool use visible in the transcript.
      renderToolCalls={TOOL_CALL_RENDERERS}
      openGenerativeUI={{
        sandboxFunctions: skin.sandboxFunctions ?? [],
        designSkill: skin.designSkill,
      }}
    >
      <CopilotChatConfigurationProvider agentId={skin.id} threadId={threadId}>
        <SkinProvider skin={skin}>
          <ChatInboxProvider
            selectedThreadId={threadId}
            onSelectThread={selectThread}
            onCreateThread={createThread}
          >
            <CanvasProvider>
              {/*
                Above BOTH consumers on purpose: the skin's `Tools` (whose
                renderers read which tool calls came from a subagent) and the
                shared `ChatPanel` (which suppresses subagent narration inline).
                One event subscription feeds both; mounting it lower would mean
                two subscriptions disagreeing about the same run.
              */}
              {/*
                KEYED BY THREAD so switching conversations gives a fresh
                accumulator instead of inheriting the previous run's console.
                Remounting is deliberate — it is React's answer to "reset state
                when an input changes" and keeps a `setState` out of an effect.
              */}
              <SubagentActivityProvider key={threadId}>
                <Providers>
                  <SkinSuggestions skin={skin} />
                  <Tools />
                  <LayoutPreferencesProvider>
                    <ShellFrame
                      activeSkinId={skin.id}
                      chat={<ChatPanel threadId={threadId} />}
                      app={
                        <Layout>
                          <CanvasRegion>{children}</CanvasRegion>
                        </Layout>
                      }
                    />
                  </LayoutPreferencesProvider>
                </Providers>
              </SubagentActivityProvider>
            </CanvasProvider>
          </ChatInboxProvider>
        </SkinProvider>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}

export default function SkinLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ skin: string }>;
}) {
  const { skin: skinId } = use(params);
  const lockedSkin = useLockedSkin();
  const skin = getSkin(skinId);
  if (!skin) notFound();
  // On a LOCK_SKIN deploy only one skin exists, so the others are as absent as a
  // nonsense segment — same 404, uniform semantics. `notFound()` throws before
  // `SkinRuntime` renders, so this client path never mounts a CopilotKitProvider,
  // a thread, or an agent registration for a disowned skin. (The server-side
  // agent registry is unaffected — LOCK_SKIN gates the UI, not the registry.)
  if (isSkinLockedOut(skin.id, lockedSkin)) notFound();
  return (
    <SkinRuntime key={skin.id} skin={skin}>
      {children}
    </SkinRuntime>
  );
}
