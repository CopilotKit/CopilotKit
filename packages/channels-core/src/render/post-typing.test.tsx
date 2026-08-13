/**
 * `thread.post(<arbitrary JSX/>)` must type-check WITHOUT a cast — under the
 * channels JSX pragma (this file's `jsxImportSource`, see tsconfig) and for a
 * plain React element built with `createElement`. A cast here would hide the
 * very API-surface regression this guards: `ReactElementLike` used to require
 * React's internal `$$typeof` brand and a `Record<string, unknown>` props type,
 * neither of which React's public `ReactElement` exposes, so every real call
 * site needed `as never`.
 *
 * The assertions are runtime-thin on purpose: `check-types` (tsc) failing on
 * this file IS the test.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import type { ReactElement } from "react";
import { Thread } from "../thread.js";
import type { ThreadDeps } from "../thread.js";
import { FakeAdapter } from "../testing/fake-adapter.js";
import { ActionRegistry } from "../action-registry.js";
import { MemoryStore } from "../state/memory-store.js";
import { kvActionStore } from "../state/kv-action-store.js";

function makeThread(adapter: FakeAdapter) {
  const store = new MemoryStore();
  const deps: ThreadDeps = {
    adapter,
    replyTarget: {},
    conversationKey: "c",
    registry: new ActionRegistry({ store: kvActionStore(store) }),
    agentFactory: () => {
      throw new Error("no agent");
    },
    tools: new Map(),
    toolDescriptors: [],
    context: [],
    registerWaiter: () => {},
    interruptHandlers: new Map(),
    state: store,
    user: null,
    actor: { id: "actor", kind: "unknown" },
    channelName: "test",
    threadId: "c",
    render: {},
    renderImage: vi.fn(async () => new Uint8Array([1])),
  };
  return new Thread(deps);
}

/** An app component with a typed props interface, authored under this file's pragma. */
interface CardProps {
  value: string;
  rows: number;
}
function Card({ value, rows }: CardProps) {
  return (
    <div style={{ display: "flex" }}>
      {value} ({rows})
    </div>
  );
}

/**
 * The same card authored the React way (a `.tsx` file with React's pragma, or
 * `createElement` directly) — a real `ReactElement<CardProps>`, which is the
 * shape `post()` must accept without a cast.
 */
function ReactCard(props: CardProps): ReactElement {
  return createElement("div", null, `${props.value} (${props.rows})`);
}

function threadWithUpload() {
  const adapter = new FakeAdapter();
  adapter.postFile = async () => ({ ok: true, messageId: "M1", fileId: "F1" });
  return makeThread(adapter);
}

describe("thread.post accepts arbitrary JSX with no cast", () => {
  it("takes a host-tag element authored under the channels pragma", async () => {
    const ref = await threadWithUpload().post(<div>hello</div>);
    expect(ref.id).toBe("M1");
  });

  it("takes an app component with a typed props interface", async () => {
    const ref = await threadWithUpload().post(<Card value="MRR" rows={3} />);
    expect(ref.id).toBe("M1");
  });

  it("takes a React element built with createElement", async () => {
    const el: ReactElement = createElement("div", null, "hi");
    const ref = await threadWithUpload().post(el);
    expect(ref.id).toBe("M1");
  });

  it("takes a typed ReactElement<P> (props is the component's own interface)", async () => {
    // The regression this pins: `props: Record<string, unknown>` rejected a
    // props *interface* (no index signature), so this line needed `as never`.
    const el: ReactElement<CardProps> = createElement(ReactCard, {
      value: "MRR",
      rows: 1,
    });
    const ref = await threadWithUpload().post(el);
    expect(ref.id).toBe("M1");
  });

  it("still accepts a plain string on the native path", async () => {
    const adapter = new FakeAdapter();
    await makeThread(adapter).post("just text");
    expect(adapter.posted).toHaveLength(1);
  });
});
