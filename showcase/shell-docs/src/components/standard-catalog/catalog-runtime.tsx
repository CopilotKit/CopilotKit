"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useStory } from "@fumadocs/story";
import { defineStoryFactory, type Story } from "@fumadocs/story/next/client";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import {
  CopilotKitProvider,
  EventType,
  HttpAgent,
} from "@copilotkit/react-core/v2";
import {
  GenerativeUISurface,
  standardUI,
  useGenerativeUIRuntime,
} from "@copilotkit/react-core/v2/generative-ui";
import { STAGE_WINDOW, Stage } from "@/components/brand/stage";
import { brandDark, brandLight } from "@/proto/code-theme";
import {
  catalogVariants,
  variantNode,
  variantOperations,
  type CatalogVariant,
} from "./catalog-story";

// The catalog pages' previews: a Fumadocs Story per component, its controls
// the component's props. Each preview draws its surface straight from the
// operations, with no model or runtime. A local agent takes the events its
// inputs send, so a click goes somewhere.

const THREAD = "docs-standard-catalog";
const AGENT = "default";

const { defineStory } = defineStoryFactory();
const stories = new Map<string, Story>();

function catalogStory(name: string) {
  let story = stories.get(name);
  if (!story) {
    const variants = catalogVariants(name);
    const Component = (args: Record<string, unknown>) => (
      <Preview variants={variants} args={args} />
    );
    story = defineStory({
      displayName: name,
      Component,
      args: variants.map((variant) => ({
        variant: variant.variant,
        description: variant.description,
        initial: variant.initial,
        controls: { node: variant.controls },
      })),
    });
    stories.set(name, story);
  }
  return story;
}

/** The shown component's node, for the JSON under the story. */
function createNodeStore() {
  let value: object | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: object) {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
type NodeStore = ReturnType<typeof createNodeStore>;
const ShownNode = createContext<NodeStore | null>(null);

function createLocalAgent() {
  return new HttpAgent({
    agentId: AGENT,
    threadId: THREAD,
    url: "/catalog/agent",
    fetch: async (_url, init) => {
      const { threadId, runId } = JSON.parse(String(init?.body)) as {
        threadId: string;
        runId: string;
      };
      const events = [
        { type: EventType.RUN_STARTED, threadId, runId },
        { type: EventType.RUN_FINISHED, threadId, runId },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
}

/**
 * The component on a canvas: a white card on the frame's lilac-grey, the way
 * the docs set cards in a tray, so it reads as a rendered component and not
 * as part of the page. The canvas fills the story's preview box.
 */
function Preview({
  variants,
  args,
}: {
  variants: CatalogVariant[];
  args: Record<string, unknown>;
}) {
  const { variant: name } = useStory();
  const variant = variants.find((v) => v.variant === name) ?? variants[0];
  const operations = useMemo(
    () => variantOperations(variant, args),
    [variant, args],
  );
  const runtime = useGenerativeUIRuntime();
  const store = useContext(ShownNode);
  useLayoutEffect(() => {
    if (!runtime) return;
    runtime.manager.setActiveThread(THREAD);
    runtime.manager.ingest(THREAD, AGENT, {
      surfaceId: variant.surfaceId,
      target: variant.surfaceId,
      catalogId: standardUI.id,
      operations: operations as never,
      status: "ready",
      rejected: [],
    });
    store?.set(variantNode(variant, args));
  }, [runtime, store, variant, args, operations]);
  return (
    <div className="-mx-2.25 -my-4 rounded-md bg-frame p-4 sm:p-8">
      <div className="min-w-0 rounded-xl bg-tray-card p-5">
        <GenerativeUISurface id={variant.surfaceId} autoScroll={false} />
      </div>
    </div>
  );
}

function NodeCode({ name }: { name: string }) {
  const store = useContext(ShownNode)!;
  const node = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (!node) return null;
  return (
    <Stage className="mt-4">
      <DynamicCodeBlock
        lang="json"
        code={JSON.stringify(node, null, 2)}
        codeblock={{
          title: `${name} as JSON`,
          className: `my-0 ${STAGE_WINDOW}`,
        }}
        options={{ themes: { light: brandLight, dark: brandDark } }}
      />
    </Stage>
  );
}

/** A CopilotKit of its own for the preview, apart from the docs' chat. */
function StoryProvider({ children }: { children: ReactNode }) {
  const [agents] = useState(() => ({ [AGENT]: createLocalAgent() }));
  const [store] = useState(createNodeStore);
  return (
    <ShownNode.Provider value={store}>
      <CopilotKitProvider
        agents__unsafe_dev_only={agents}
        enableInspector={false}
        generativeUI={{ ui: standardUI }}
      >
        {children}
      </CopilotKitProvider>
    </ShownNode.Provider>
  );
}

/**
 * A component's story: its variants, a live preview with a control for each
 * of its props, and the component as the agent writes it.
 */
export function CatalogStory({ name }: { name: string }) {
  const story = catalogStory(name);
  return (
    <div className="not-prose my-6">
      <StoryProvider>
        <story.WithControl />
        <NodeCode name={name} />
      </StoryProvider>
    </div>
  );
}
