// oxlint-disable typescript/consistent-type-imports
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import type { AbstractAgent } from "@ag-ui/client";
import { useAgent } from "../../../hooks/use-agent";
import { mountWithProvider } from "../../../__tests__/utils/mount";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import CopilotChat from "../CopilotChat.vue";
import type { CopilotPopupProps, CopilotSidebarProps } from "../types";

vi.mock("../../../hooks/use-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../hooks/use-agent")>();
  return {
    ...actual,
    useAgent: vi.fn(),
  };
});

const mockUseAgent = useAgent as ReturnType<typeof vi.fn>;

function createHost(props: Record<string, unknown> = {}) {
  return defineComponent({
    components: { CopilotChat },
    setup() {
      return { props };
    },
    template: `<CopilotChat v-bind="props" :welcome-screen="false" />`,
  });
}

describe("CopilotChat throttleMs prop", () => {
  let mockAgent: MockStepwiseAgent;

  beforeEach(() => {
    mockUseAgent.mockReset();
    mockAgent = new MockStepwiseAgent();
    mockAgent.agentId = "default";
    mockUseAgent.mockReturnValue({ agent: ref(mockAgent) });
  });

  it("passes throttleMs prop to useAgent", () => {
    mountWithProvider(() => h(createHost({ throttleMs: 500 })), {
      agents__unsafe_dev_only: { default: mockAgent as AbstractAgent },
    });

    expect(mockUseAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        throttleMs: expect.any(Object),
      }),
    );
    const throttleArg = mockUseAgent.mock.calls[0]?.[0]?.throttleMs;
    expect(typeof throttleArg).toBe("object");
    expect(throttleArg?.value).toBe(500);
  });

  it("passes undefined throttleMs when prop is not set", () => {
    mountWithProvider(() => h(createHost()), {
      agents__unsafe_dev_only: { default: mockAgent as AbstractAgent },
    });

    expect(mockUseAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        throttleMs: expect.any(Object),
      }),
    );
    const throttleArg = mockUseAgent.mock.calls[0]?.[0]?.throttleMs;
    expect(throttleArg?.value).toBeUndefined();
  });
});

describe("throttleMs type inheritance", () => {
  it("CopilotSidebarProps includes throttleMs via CopilotChatProps", () => {
    const sidebarProps: CopilotSidebarProps = { throttleMs: 1000 };
    expect(sidebarProps.throttleMs).toBe(1000);
  });

  it("CopilotPopupProps includes throttleMs via CopilotChatProps", () => {
    const popupProps: CopilotPopupProps = { throttleMs: 2000 };
    expect(popupProps.throttleMs).toBe(2000);
  });
});
