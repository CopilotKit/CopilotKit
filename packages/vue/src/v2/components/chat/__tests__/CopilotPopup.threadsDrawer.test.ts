/**
 * `threadsDrawer` on `<CopilotPopup>` / `<CopilotSidebar>`: an opt-in threads
 * drawer hosted as an overlay inside the chat modal.
 *
 * - Off (the default) renders no launcher and no drawer.
 * - On, the modal header shows the thread-list launcher at every viewport
 *   width, and it opens the drawer (`overlay` mode) inside the modal.
 * - The drawer's open state is local to the modal: it doesn't drive a
 *   page-level `<CopilotThreadsDrawer>`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import type { CopilotKitThreadsDrawer as CopilotKitThreadsDrawerElement } from "@copilotkit/web-components/threads-drawer";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotPopup from "../CopilotPopup.vue";
import CopilotSidebar from "../CopilotSidebar.vue";
import CopilotThreadsDrawer from "../CopilotThreadsDrawer.vue";
import { useCopilotChatConfiguration } from "../../../providers/useCopilotChatConfiguration";
import type { ModalThreadsDrawerProp } from "../types";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";

const LAUNCHER = "drawer-launcher";

function renderHarness(
  surface: "popup" | "sidebar",
  threadsDrawer?: ModalThreadsDrawerProp,
  pageDrawer = false,
) {
  return render(
    defineComponent({
      components: {
        CopilotKitProvider,
        CopilotChatConfigurationProvider,
        CopilotThreadsDrawer,
        Surface: surface === "popup" ? CopilotPopup : CopilotSidebar,
      },
      setup() {
        return {
          agents: { default: new MockStepwiseAgent() },
          threadsDrawer,
          pageDrawer,
        };
      },
      template: `
        <CopilotKitProvider :agents__unsafe_dev_only="agents">
          <CopilotChatConfigurationProvider>
            <CopilotThreadsDrawer v-if="pageDrawer" data-test-id="page-drawer" />
            <Surface :default-open="true" :threads-drawer="threadsDrawer" />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      `,
    }),
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

/** Lets the lazily-loaded drawer element resolve before "absent" checks. */
const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  { name: "CopilotPopup", surface: "popup" as const },
  { name: "CopilotSidebar", surface: "sidebar" as const },
])("<$name threadsDrawer>", ({ surface }) => {
  it("is off by default: no launcher and no drawer", async () => {
    renderHarness(surface);
    await settle();
    expect(screen.queryByTestId(LAUNCHER)).toBeNull();
    expect(document.querySelector("copilotkit-threads-drawer")).toBeNull();
  });

  it("shows the launcher on desktop and hosts a closed overlay drawer inside the modal", async () => {
    renderHarness(surface, true);

    const launcher = await screen.findByTestId(LAUNCHER);
    expect(launcher.getAttribute("aria-expanded")).toBe("false");

    const drawer = await findModalDrawer();
    await waitFor(() => expect(drawer.overlay).toBe(true));
    expect(drawer.open).toBe(false);
  });

  it("the launcher opens the drawer inside the modal", async () => {
    renderHarness(surface, true);
    const launcher = await screen.findByTestId(LAUNCHER);
    const drawer = await findModalDrawer();

    await fireEvent.click(launcher);
    await waitFor(() => expect(drawer.open).toBe(true));
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps its open state separate from a page-level drawer", async () => {
    renderHarness(surface, true, true);
    const launcher = await screen.findByTestId(LAUNCHER);
    const drawer = await findModalDrawer();
    await waitFor(() =>
      expect(
        document.querySelectorAll("copilotkit-threads-drawer"),
      ).toHaveLength(2),
    );
    const pageDrawer = [
      ...document.querySelectorAll<CopilotKitThreadsDrawerElement>(
        "copilotkit-threads-drawer",
      ),
    ].find((el) => el !== drawer)!;

    await fireEvent.click(launcher);
    await waitFor(() => expect(drawer.open).toBe(true));
    expect(pageDrawer.open).toBe(false);
    expect(pageDrawer.overlay).toBe(false);
  });
});

/**
 * Picking a thread (or "New Thread") in the modal's drawer drives the chat
 * itself, with or without a chat configuration provider around the modal.
 */
describe.each([
  { name: "CopilotPopup", surface: "popup" as const },
  { name: "CopilotSidebar", surface: "sidebar" as const },
])("<$name threadsDrawer> thread switching", ({ surface }) => {
  function renderSwitchHarness(outerProvider: boolean) {
    const agent = new MockStepwiseAgent();
    render(
      defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          Surface: surface === "popup" ? CopilotPopup : CopilotSidebar,
        },
        setup() {
          return { agents: { default: agent }, outerProvider };
        },
        template: `
          <CopilotKitProvider :agents__unsafe_dev_only="agents">
            <CopilotChatConfigurationProvider v-if="outerProvider">
              <Surface :default-open="true" :threads-drawer="true" />
            </CopilotChatConfigurationProvider>
            <Surface v-else :default-open="true" :threads-drawer="true" />
          </CopilotKitProvider>
        `,
      }),
    );
    return agent;
  }

  function selectThread(drawer: HTMLElement, threadId: string) {
    drawer.dispatchEvent(
      new CustomEvent("thread-selected", {
        detail: { threadId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  it.each([
    { label: "inside a chat configuration provider", outerProvider: true },
    { label: "with no provider around it", outerProvider: false },
  ])("switches the chat's thread $label", async ({ outerProvider }) => {
    const agent = renderSwitchHarness(outerProvider);
    const drawer = await findModalDrawer();

    selectThread(drawer, "thread-a");
    await waitFor(() => expect(agent.threadId).toBe("thread-a"));
    await waitFor(() => expect(drawer.activeThreadId).toBe("thread-a"));

    // A second pick switches again (an explicit thread doesn't pin the chat).
    selectThread(drawer, "thread-b");
    await waitFor(() => expect(agent.threadId).toBe("thread-b"));

    // "New Thread" moves to a fresh thread.
    drawer.dispatchEvent(
      new CustomEvent("new-thread", { bubbles: true, composed: true }),
    );
    await waitFor(() => expect(agent.threadId).not.toBe("thread-b"));
  });
});

/**
 * The popup and sidebar add a chat configuration of their own only when the
 * drawer needs one: with `threadsDrawer` on and no provider above them.
 */
describe.each([
  { name: "CopilotPopup", surface: "popup" as const },
  { name: "CopilotSidebar", surface: "sidebar" as const },
])("<$name threadsDrawer> thread scope", ({ surface }) => {
  const Surface = surface === "popup" ? CopilotPopup : CopilotSidebar;

  it("switches the thread of the provider around it", async () => {
    const ThreadProbe = defineComponent({
      setup() {
        const config = useCopilotChatConfiguration();
        return { config };
      },
      template: `<span data-testid="page-thread">{{ config?.threadId }}</span>`,
    });
    render(
      defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          Surface,
          ThreadProbe,
        },
        setup() {
          return { agents: { default: new MockStepwiseAgent() } };
        },
        template: `
          <CopilotKitProvider :agents__unsafe_dev_only="agents">
            <CopilotChatConfigurationProvider>
              <ThreadProbe />
              <Surface :default-open="true" :threads-drawer="true" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      }),
    );
    const drawer = await findModalDrawer();

    drawer.dispatchEvent(
      new CustomEvent("thread-selected", {
        detail: { threadId: "thread-a" },
        bubbles: true,
        composed: true,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("page-thread").textContent).toBe("thread-a"),
    );
  });

  it("starts a fresh thread when its threadId prop is cleared", async () => {
    const agent = new MockStepwiseAgent();
    const threadId = ref<string | undefined>(undefined);
    render(
      defineComponent({
        components: { CopilotKitProvider, Surface },
        setup() {
          return { agents: { default: agent }, threadId };
        },
        template: `
          <CopilotKitProvider :agents__unsafe_dev_only="agents">
            <Surface :default-open="true" :threads-drawer="true" :thread-id="threadId" />
          </CopilotKitProvider>
        `,
      }),
    );
    await findModalDrawer();
    await waitFor(() => expect(agent.threadId).toBeTruthy());
    const mountThread = agent.threadId;

    threadId.value = "thread-a";
    await waitFor(() => expect(agent.threadId).toBe("thread-a"));

    threadId.value = undefined;
    await waitFor(() => expect(agent.threadId).not.toBe("thread-a"));
    expect(agent.threadId).not.toBe(mountThread);
  });
});
