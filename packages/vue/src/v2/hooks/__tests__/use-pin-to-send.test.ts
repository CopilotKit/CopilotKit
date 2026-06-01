import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, provide, ref } from "vue";
import { mount } from "@vue/test-utils";
import { usePinToSend } from "../use-pin-to-send";
import {
  LastUserMessageKey,
  type LastUserMessageState,
} from "../../components/chat/last-user-message-context";

// Strict counterpart of React `use-pin-to-send.test.tsx`.
// Keep case order, wording, and harness shape aligned 1:1 with the React suite.
//
// Vue divergences from the React harness:
// - React passes `LastUserMessageContext.Provider value={...}` and rerenders
//   to mutate it. Vue idiomatically `provide()`s a `Ref<LastUserMessageState>`
//   and mutates `.value` to trigger downstream `watch` effects.
// - React stubs `requestAnimationFrame`; Vue tests do the same to keep
//   scroll assertions deterministic in jsdom.

function setHeight(el: HTMLElement, height: number) {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(el, "offsetHeight", {
    configurable: true,
    value: height,
  });
  el.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      width: 100,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

const HarnessInner = defineComponent({
  props: {
    topOffset: { type: Number, default: 16 },
  },
  setup(props) {
    const scrollRef = ref<HTMLElement | null>(null);
    const contentRef = ref<HTMLElement | null>(null);
    const spacerRef = ref<HTMLElement | null>(null);

    usePinToSend({
      scrollRef,
      contentRef,
      spacerRef,
      topOffset: props.topOffset,
    });

    return () =>
      h("div", { ref: scrollRef, "data-testid": "scroll" }, [
        h("div", { ref: contentRef, "data-testid": "content" }, [
          h(
            "div",
            { "data-message-id": "m1", "data-role": "user" },
            "user msg 1",
          ),
          h(
            "div",
            {
              "data-message-id": "m2",
              "data-role": "assistant",
            },
            "asst msg 1",
          ),
          h(
            "div",
            { "data-message-id": "m3", "data-role": "user" },
            "user msg 2",
          ),
        ]),
        h("div", {
          ref: spacerRef,
          "data-testid": "spacer",
          style: { height: "0px" },
        }),
      ]);
  },
});

function mountHarness(initial: LastUserMessageState, topOffset = 16) {
  const lastUserMessage = ref<LastUserMessageState>({ ...initial });
  const wrapper = mount(
    defineComponent({
      setup() {
        provide(LastUserMessageKey, lastUserMessage);
        return () => h(HarnessInner, { topOffset });
      },
    }),
    { attachTo: document.body },
  );

  return {
    wrapper,
    lastUserMessage,
    scroll: wrapper.get("[data-testid='scroll']").element as HTMLElement,
    content: wrapper.get("[data-testid='content']").element as HTMLElement,
    spacer: wrapper.get("[data-testid='spacer']").element as HTMLElement,
  };
}

beforeEach(() => {
  HTMLElement.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
  // jsdom does not run rAF callbacks — stub it to fire synchronously so scroll
  // assertions work (mirrors React harness setup).
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePinToSend", () => {
  it("sets spacer height to viewportHeight - userMessageHeight - topOffset on new send", async () => {
    const harness = mountHarness({ id: null, sendNonce: 0 });

    setHeight(harness.scroll, 800);
    const userMsg = harness.scroll.querySelector(
      '[data-message-id="m3"]',
    ) as HTMLElement;
    setHeight(userMsg, 40);

    harness.lastUserMessage.value = { id: "m3", sendNonce: 1 };
    await nextTick();

    // viewport=800, userMsg=40, topOffset=16
    // spacer = max(0, 800 - 40 - 16) = 744
    expect(harness.spacer.style.height).toBe("744px");
  });

  it("calls scrollTo with targetEl.offsetTop - topOffset on new send", async () => {
    const harness = mountHarness({ id: null, sendNonce: 0 });

    setHeight(harness.scroll, 800);
    const scrollTo = harness.scroll.scrollTo as unknown as ReturnType<
      typeof vi.fn
    >;

    const userMsg = harness.scroll.querySelector(
      '[data-message-id="m3"]',
    ) as HTMLElement;
    setHeight(userMsg, 40);
    // computeOffsetTop uses getBoundingClientRect; mock top=400 on userMsg
    // and top=0 on scroll so elRect.top - stopRect.top + scrollEl.scrollTop =
    // 400 - 0 + 0 = 400.
    userMsg.getBoundingClientRect = () =>
      ({
        top: 400,
        left: 0,
        right: 100,
        bottom: 440,
        width: 100,
        height: 40,
        x: 0,
        y: 400,
        toJSON: () => ({}),
      }) as DOMRect;

    harness.lastUserMessage.value = { id: "m3", sendNonce: 1 };
    await nextTick();

    expect(scrollTo).toHaveBeenCalledWith({
      top: 400 - 16,
      behavior: "smooth",
    });
  });

  it("shrinks spacer as content height grows (does not grow it)", async () => {
    let observed: (() => void) | null = null;
    // Must use a class (not an arrow function) so `new ResizeObserver(...)` works in jsdom.
    class ROStub {
      constructor(cb: () => void) {
        observed = cb;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    const prevRO = global.ResizeObserver;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.ResizeObserver = ROStub as any;

    let wrapper: ReturnType<typeof mountHarness>["wrapper"] | null = null;
    try {
      const harness = mountHarness({ id: null, sendNonce: 0 });
      wrapper = harness.wrapper;
      setHeight(harness.scroll, 800);
      const userMsg = harness.scroll.querySelector(
        '[data-message-id="m3"]',
      ) as HTMLElement;
      setHeight(userMsg, 40);
      setHeight(harness.content, 200);

      harness.lastUserMessage.value = { id: "m3", sendNonce: 1 };
      await nextTick();

      // Initial: 800 - 40 - 16 = 744
      expect(harness.spacer.style.height).toBe("744px");

      // Simulate content growing — spacer should shrink
      setHeight(harness.content, 600);
      observed?.();
      expect(parseInt(harness.spacer.style.height, 10)).toBeLessThan(744);

      // Simulate content shrinking — spacer should NOT grow back
      setHeight(harness.content, 100);
      const shrunkHeight = harness.spacer.style.height;
      observed?.();
      expect(harness.spacer.style.height).toBe(shrunkHeight);
    } finally {
      wrapper?.unmount();
      global.ResizeObserver = prevRO;
    }
  });

  it("cancels the scheduled rAF on unmount (cleanup)", async () => {
    const cancelSpy = vi.spyOn(global, "cancelAnimationFrame");
    try {
      const harness = mountHarness({ id: null, sendNonce: 0 });
      setHeight(harness.scroll, 800);
      const userMsg = harness.scroll.querySelector(
        '[data-message-id="m3"]',
      ) as HTMLElement;
      setHeight(userMsg, 40);

      harness.lastUserMessage.value = { id: "m3", sendNonce: 1 };
      await nextTick();

      harness.wrapper.unmount();
      expect(cancelSpy).toHaveBeenCalled();
    } finally {
      cancelSpy.mockRestore();
    }
  });
});

// Vue-specific regression coverage: keep React-mirrored cases above, then
// add the Vue-only watch-cleanup contract here. Vue's `watch` does not run
// the previous run's cleanup automatically the way React's `useEffect`
// does, so the implementation must explicitly register `teardown` via
// `onCleanup`. These tests prove that a `ref` swap or `topOffset` change
// without a new send still disconnects the prior `ResizeObserver`.
describe("usePinToSend Vue-specific watch cleanup", () => {
  it("disconnects the ResizeObserver when spacerRef goes from element to null without a new sendNonce", async () => {
    let lastDisconnect: ReturnType<typeof vi.fn> | null = null;
    let installCount = 0;
    // Must use a class (not an arrow function) so `new ResizeObserver(...)` works in jsdom.
    class ROStub {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor() {
        installCount += 1;
        this.disconnect = vi.fn();
        lastDisconnect = this.disconnect;
      }
    }
    const prevRO = global.ResizeObserver;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.ResizeObserver = ROStub as any;

    const lastUserMessage = ref<LastUserMessageState>({
      id: null,
      sendNonce: 0,
    });
    const showSpacer = ref(true);

    const HarnessToggleable = defineComponent({
      setup() {
        const scrollRef = ref<HTMLElement | null>(null);
        const contentRef = ref<HTMLElement | null>(null);
        const spacerRef = ref<HTMLElement | null>(null);

        usePinToSend({ scrollRef, contentRef, spacerRef, topOffset: 16 });

        return () =>
          h("div", { ref: scrollRef, "data-testid": "scroll" }, [
            h("div", { ref: contentRef, "data-testid": "content" }, [
              h(
                "div",
                { "data-message-id": "m3", "data-role": "user" },
                "user msg 2",
              ),
            ]),
            showSpacer.value
              ? h("div", {
                  ref: spacerRef,
                  "data-testid": "spacer",
                  style: { height: "0px" },
                })
              : null,
          ]);
      },
    });

    try {
      const wrapper = mount(
        defineComponent({
          setup() {
            provide(LastUserMessageKey, lastUserMessage);
            return () => h(HarnessToggleable);
          },
        }),
        { attachTo: document.body },
      );

      const scroll = wrapper.get("[data-testid='scroll']")
        .element as HTMLElement;
      setHeight(scroll, 800);
      const userMsg = scroll.querySelector(
        '[data-message-id="m3"]',
      ) as HTMLElement;
      setHeight(userMsg, 40);

      // First send installs a ResizeObserver against the content element.
      lastUserMessage.value = { id: "m3", sendNonce: 1 };
      await nextTick();
      await nextTick();
      expect(installCount).toBe(1);
      expect(lastDisconnect).not.toBeNull();
      expect(lastDisconnect).not.toHaveBeenCalled();

      // Toggle the spacer off (autoScroll mode flip). Because `sendNonce`
      // didn't change, the watcher's body early-returns. The previous
      // run's `onCleanup(teardown)` must still fire and disconnect the RO.
      showSpacer.value = false;
      await nextTick();
      await nextTick();
      expect(lastDisconnect).toHaveBeenCalled();

      // Toggling back without a new nonce must NOT install a new RO,
      // mirroring React's `lastNonceRef` early-return semantics.
      showSpacer.value = true;
      await nextTick();
      await nextTick();
      expect(installCount).toBe(1);

      // A new send re-anchors and installs a fresh RO.
      lastUserMessage.value = { id: "m3", sendNonce: 2 };
      await nextTick();
      await nextTick();
      expect(installCount).toBe(2);

      wrapper.unmount();
    } finally {
      global.ResizeObserver = prevRO;
    }
  });
});
