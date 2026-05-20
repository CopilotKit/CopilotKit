import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  CopilotChatConfigurationProvider,
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "../CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { MockStepwiseAgent } from "../../__tests__/utils/test-helpers";
import { CopilotChat } from "../../components/chat/CopilotChat";

// Test component to access configuration
function ConfigurationDisplay() {
  const config = useCopilotChatConfiguration();
  return (
    <div>
      <div data-testid="agentId">{config?.agentId || "no-config"}</div>
      <div data-testid="threadId">{config?.threadId || "no-config"}</div>
      <div data-testid="placeholder">
        {config?.labels.chatInputPlaceholder || "no-config"}
      </div>
      <div data-testid="copyLabel">
        {config?.labels.assistantMessageToolbarCopyMessageLabel || "no-config"}
      </div>
    </div>
  );
}

describe("CopilotChatConfigurationProvider", () => {
  describe("Basic functionality", () => {
    it("should provide default configuration", () => {
      render(
        <CopilotChatConfigurationProvider threadId="test-thread">
          <ConfigurationDisplay />
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("agentId").textContent).toBe(DEFAULT_AGENT_ID);
      expect(screen.getByTestId("threadId").textContent).toBe("test-thread");
      expect(screen.getByTestId("placeholder").textContent).toBe(
        CopilotChatDefaultLabels.chatInputPlaceholder,
      );
    });

    it("should accept custom agentId", () => {
      render(
        <CopilotChatConfigurationProvider
          threadId="test-thread"
          agentId="custom-agent"
        >
          <ConfigurationDisplay />
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("agentId").textContent).toBe("custom-agent");
    });

    it("should merge custom labels with defaults", () => {
      const customLabels = {
        chatInputPlaceholder: "Custom placeholder",
      };

      render(
        <CopilotChatConfigurationProvider
          threadId="test-thread"
          labels={customLabels}
        >
          <ConfigurationDisplay />
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("placeholder").textContent).toBe(
        "Custom placeholder",
      );
      // Other labels should still have defaults
      expect(screen.getByTestId("copyLabel").textContent).toBe(
        CopilotChatDefaultLabels.assistantMessageToolbarCopyMessageLabel,
      );
    });
  });

  describe("Hook behavior", () => {
    it("should return null when no provider exists", () => {
      render(<ConfigurationDisplay />);

      expect(screen.getByTestId("agentId").textContent).toBe("no-config");
      expect(screen.getByTestId("threadId").textContent).toBe("no-config");
      expect(screen.getByTestId("placeholder").textContent).toBe("no-config");
    });
  });

  describe("CopilotChat priority merging", () => {
    it("should use defaults when no provider exists and no props passed", () => {
      // CopilotChat creates its own provider, so we need to check inside it
      // We'll check the input placeholder which uses the configuration
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotChat />
        </CopilotKitProvider>,
      );

      // Find the input element and check its placeholder
      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe(
        CopilotChatDefaultLabels.chatInputPlaceholder,
      );
    });

    it("should inherit from existing provider when CopilotChat has no props", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            "outer-agent": new MockStepwiseAgent({ agentId: "outer-agent" }),
          }}
        >
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            agentId="outer-agent"
            labels={{ chatInputPlaceholder: "Outer placeholder" }}
          >
            <CopilotChat />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Check that the input inherits the outer placeholder
      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe("Outer placeholder");
    });

    it("should override existing provider with CopilotChat props", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            "inner-agent": new MockStepwiseAgent({ agentId: "inner-agent" }),
          }}
        >
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            agentId="outer-agent"
            labels={{ chatInputPlaceholder: "Outer placeholder" }}
          >
            <CopilotChat
              agentId="inner-agent"
              threadId="inner-thread"
              labels={{ chatInputPlaceholder: "Inner placeholder" }}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // CopilotChat props should win - check the input placeholder
      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe("Inner placeholder");
    });

    it("should merge labels correctly with priority: default < existing < props", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            labels={{
              chatInputPlaceholder: "Outer placeholder",
              assistantMessageToolbarCopyMessageLabel: "Outer copy",
            }}
          >
            <CopilotChat
              labels={{
                chatInputPlaceholder: "Inner placeholder",
                // Not overriding copyLabel, should inherit from outer
              }}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe("Inner placeholder");
      // The copy label would be tested if we had assistant messages
    });

    it("should handle partial overrides correctly", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            "outer-agent": new MockStepwiseAgent({ agentId: "outer-agent" }),
          }}
        >
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            agentId="outer-agent"
            labels={{ chatInputPlaceholder: "Outer placeholder" }}
          >
            <CopilotChat
              // Only override threadId and some labels, not agentId
              threadId="inner-thread"
              labels={{
                chatInputPlaceholder: "Inner placeholder",
              }}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // Check the placeholder was overridden
      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe("Inner placeholder");
      // agentId and other properties would be tested through agent behavior
    });

    it("should allow accessing configuration outside CopilotChat in same provider", () => {
      // This shows that ConfigurationDisplay outside CopilotChat
      // sees the outer provider values, not the inner merged ones
      render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            "outer-agent": new MockStepwiseAgent({ agentId: "outer-agent" }),
          }}
        >
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            agentId="outer-agent"
            labels={{ chatInputPlaceholder: "Outer placeholder" }}
          >
            <CopilotChat
              threadId="inner-thread"
              labels={{ chatInputPlaceholder: "Inner placeholder" }}
            />
            <ConfigurationDisplay />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      // ConfigurationDisplay is outside CopilotChat, so it sees outer values
      expect(screen.getByTestId("agentId").textContent).toBe("outer-agent");
      expect(screen.getByTestId("threadId").textContent).toBe("outer-thread");
      expect(screen.getByTestId("placeholder").textContent).toBe(
        "Outer placeholder",
      );
    });
  });

  describe("Modal state", () => {
    it("should always provide setModalOpen and isModalOpen even without isModalDefaultOpen", () => {
      function ModalStateDisplay() {
        const config = useCopilotChatConfiguration();
        return (
          <div>
            <div data-testid="hasSetModalOpen">
              {config?.setModalOpen ? "yes" : "no"}
            </div>
            <div data-testid="hasIsModalOpen">
              {config?.isModalOpen !== undefined ? "yes" : "no"}
            </div>
          </div>
        );
      }

      render(
        <CopilotChatConfigurationProvider threadId="test-thread">
          <ModalStateDisplay />
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("hasSetModalOpen").textContent).toBe("yes");
      expect(screen.getByTestId("hasIsModalOpen").textContent).toBe("yes");
    });

    it("should respect isModalDefaultOpen when provided", () => {
      function ModalStateDisplay() {
        const config = useCopilotChatConfiguration();
        return (
          <div>
            <div data-testid="isModalOpen">
              {config?.isModalOpen ? "open" : "closed"}
            </div>
          </div>
        );
      }

      render(
        <CopilotChatConfigurationProvider
          threadId="test-thread"
          isModalDefaultOpen={false}
        >
          <ModalStateDisplay />
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("isModalOpen").textContent).toBe("closed");
    });

    it("should inherit parent modal state when child has no isModalDefaultOpen", () => {
      function ModalStateDisplay() {
        const config = useCopilotChatConfiguration();
        return (
          <div>
            <div data-testid="isModalOpen">
              {config?.isModalOpen ? "open" : "closed"}
            </div>
            <div data-testid="hasSetModalOpen">
              {config?.setModalOpen ? "yes" : "no"}
            </div>
          </div>
        );
      }

      render(
        <CopilotChatConfigurationProvider
          threadId="outer-thread"
          isModalDefaultOpen={false}
        >
          <CopilotChatConfigurationProvider threadId="inner-thread">
            <ModalStateDisplay />
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      // Child should inherit parent's modal state (closed)
      expect(screen.getByTestId("isModalOpen").textContent).toBe("closed");
      expect(screen.getByTestId("hasSetModalOpen").textContent).toBe("yes");
    });

    it("should allow nested provider to override parent modal state with explicit isModalDefaultOpen", () => {
      function ModalStateDisplay() {
        const config = useCopilotChatConfiguration();
        return (
          <div>
            <div data-testid="isModalOpen">
              {config?.isModalOpen ? "open" : "closed"}
            </div>
          </div>
        );
      }

      render(
        <CopilotChatConfigurationProvider
          threadId="outer-thread"
          isModalDefaultOpen={true}
        >
          <CopilotChatConfigurationProvider
            threadId="inner-thread"
            isModalDefaultOpen={false}
          >
            <ModalStateDisplay />
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("isModalOpen").textContent).toBe("closed");
    });
  });

  /**
   * CPK-7152: Bidirectional sync between nested providers.
   *
   * The fix must satisfy both:
   *   Behavior A — child provider respects its own isModalDefaultOpen even
   *                when a parent provider exists (covered by the existing
   *                "allow nested provider to override" test above).
   *   Behavior B — state changes in the inner provider propagate outward so
   *                that hooks reading from an outer provider stay in sync.
   *
   * Scenarios mirror the reproduction cases in:
   * https://github.com/CopilotKit/deep-agent-cpk-experiments/tree/main/app/client/src/tickets/tkt-modal-default-open
   */
  describe("Bidirectional sync (CPK-7152)", () => {
    // Reusable probe/control component that reads the closest provider.
    function ModalControls({ id }: { id: string }) {
      const config = useCopilotChatConfiguration();
      return (
        <>
          <div data-testid={`${id}-state`}>{String(config?.isModalOpen)}</div>
          <button
            data-testid={`${id}-open`}
            onClick={() => config?.setModalOpen(true)}
          >
            open
          </button>
          <button
            data-testid={`${id}-close`}
            onClick={() => config?.setModalOpen(false)}
          >
            close
          </button>
        </>
      );
    }

    it("scenario-sidebar-outer-hook: inner setModalOpen propagates to outer hook (Behavior B)", () => {
      // Abe.Hu's layout: outer bare provider, inner provider owns explicit state.
      // Toggling via the inner provider should update the outer hook.
      render(
        <CopilotChatConfigurationProvider threadId="outer">
          {/* OuterProbe sits outside the inner provider — reads outer context */}
          <ModalControls id="outer" />
          <CopilotChatConfigurationProvider
            threadId="inner"
            isModalDefaultOpen={true}
          >
            <ModalControls id="inner" />
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("outer-state").textContent).toBe("true");
      expect(screen.getByTestId("inner-state").textContent).toBe("true");

      act(() => {
        fireEvent.click(screen.getByTestId("inner-close"));
      });

      // Inner closed — outer hook must reflect the change.
      expect(screen.getByTestId("inner-state").textContent).toBe("false");
      expect(screen.getByTestId("outer-state").textContent).toBe("false");
    });

    it("scenario-sidebar-outer-hook: outer setModalOpen propagates to inner (parent→child sync)", () => {
      // If the user calls setModalOpen from the outer hook, the inner
      // provider (and therefore the sidebar) must respond.
      render(
        <CopilotChatConfigurationProvider
          threadId="outer"
          isModalDefaultOpen={false}
        >
          <ModalControls id="outer" />
          <CopilotChatConfigurationProvider
            threadId="inner"
            isModalDefaultOpen={false}
          >
            <ModalControls id="inner" />
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("outer-state").textContent).toBe("false");
      expect(screen.getByTestId("inner-state").textContent).toBe("false");

      act(() => {
        fireEvent.click(screen.getByTestId("outer-open"));
      });

      // Outer opened — inner must follow.
      expect(screen.getByTestId("outer-state").textContent).toBe("true");
      expect(screen.getByTestId("inner-state").textContent).toBe("true");
    });

    it("scenario-nested-provider: three-level chain propagates through middle provider", () => {
      // Mirrors the real provider stack:
      //   Provider 1 (user's outer, no isModalDefaultOpen)
      //     └── Provider 2 (CopilotChat's, no isModalDefaultOpen) — "middle"
      //           └── Provider 3 (CopilotSidebarView's, explicit isModalDefaultOpen)
      //
      // Toggling P3 must reach P1 even though P2 has no explicit default.
      render(
        <CopilotChatConfigurationProvider threadId="p1">
          <ModalControls id="p1" />
          <CopilotChatConfigurationProvider threadId="p2">
            {/* p2 has no isModalDefaultOpen — proxies p1's state */}
            <CopilotChatConfigurationProvider
              threadId="p3"
              isModalDefaultOpen={true}
            >
              <ModalControls id="p3" />
            </CopilotChatConfigurationProvider>
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("p1-state").textContent).toBe("true");
      expect(screen.getByTestId("p3-state").textContent).toBe("true");

      act(() => {
        fireEvent.click(screen.getByTestId("p3-close"));
      });

      expect(screen.getByTestId("p3-state").textContent).toBe("false");
      expect(screen.getByTestId("p1-state").textContent).toBe("false");
    });

    it("scenario-nested-provider: Behavior A still holds after sync fix (no regression)", () => {
      // Explicit isModalDefaultOpen on a child must still override the
      // parent's current value on initial render — the sync effect must
      // not overwrite the child's own initial state.
      render(
        <CopilotChatConfigurationProvider
          threadId="outer"
          isModalDefaultOpen={true}
        >
          <ModalControls id="outer" />
          <CopilotChatConfigurationProvider
            threadId="inner"
            isModalDefaultOpen={false}
          >
            <ModalControls id="inner" />
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      // Inner must start closed despite outer being open.
      expect(screen.getByTestId("outer-state").textContent).toBe("true");
      expect(screen.getByTestId("inner-state").textContent).toBe("false");
    });
  });

  /**
   * Regression coverage for the welcome-screen / /connect 404 bug
   * (fix/welcome-not-showing-at-all). `hasExplicitThreadId` distinguishes a
   * caller-chosen thread from a UUID auto-minted inside the provider chain —
   * consumers that only make sense against a real backend thread (/connect,
   * switch-flash suppression) must gate on this signal, not on !!threadId.
   */
  describe("hasExplicitThreadId", () => {
    function ExplicitProbe({ id = "probe" }: { id?: string } = {}) {
      const config = useCopilotChatConfiguration();
      return (
        <div data-testid={`${id}-explicit`}>
          {String(config?.hasExplicitThreadId)}
        </div>
      );
    }

    it("infers true when threadId prop is supplied and hasExplicitThreadId is omitted", () => {
      render(
        <CopilotChatConfigurationProvider threadId="customer-thread">
          <ExplicitProbe />
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("probe-explicit").textContent).toBe("true");
    });

    it("infers false when no threadId prop is supplied and hasExplicitThreadId is omitted", () => {
      render(
        <CopilotChatConfigurationProvider>
          <ExplicitProbe />
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("probe-explicit").textContent).toBe("false");
    });

    it("respects hasExplicitThreadId={false} even when a threadId prop is present (v1 bridge case)", () => {
      // The v1 <CopilotKit> wrapper always pipes a UUID through as `threadId`
      // (from ThreadsProvider). Without this override the provider would
      // mis-infer the UUID as explicit, causing /connect to 404 and the
      // welcome screen to stay hidden for fresh empty chats.
      render(
        <CopilotChatConfigurationProvider
          threadId="auto-minted-uuid"
          hasExplicitThreadId={false}
        >
          <ExplicitProbe />
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("probe-explicit").textContent).toBe("false");
    });

    it("parent=true overrides child's hasExplicitThreadId={false} via OR inheritance", () => {
      // resolvedHasExplicitThreadId = ownHasExplicit || parentHasExplicit.
      // Once an ancestor has marked the thread as caller-chosen, descendants
      // cannot mask that — pinning the contract so "try to hide explicitness
      // from a child" doesn't silently work.
      render(
        <CopilotChatConfigurationProvider threadId="real-thread">
          <CopilotChatConfigurationProvider
            threadId="other-uuid"
            hasExplicitThreadId={false}
          >
            <ExplicitProbe />
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("probe-explicit").textContent).toBe("true");
    });

    it("propagates through a three-level chain where the middle provider is bare", () => {
      // Matches the real stack: outer layout provider (no threadId) →
      // CopilotChat's own provider (no threadId) → inner feature provider
      // (explicit threadId). Explicitness must cross the empty middle.
      render(
        <CopilotChatConfigurationProvider>
          <CopilotChatConfigurationProvider>
            <CopilotChatConfigurationProvider threadId="deeply-picked-thread">
              <ExplicitProbe />
            </CopilotChatConfigurationProvider>
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("probe-explicit").textContent).toBe("true");
    });

    it("non-explicit parent does not taint an explicit child", () => {
      render(
        <CopilotChatConfigurationProvider
          threadId="auto-uuid"
          hasExplicitThreadId={false}
        >
          <CopilotChatConfigurationProvider threadId="user-picked">
            <ExplicitProbe />
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      expect(screen.getByTestId("probe-explicit").textContent).toBe("true");
    });
  });

  describe("Nested providers", () => {
    it("should handle multiple nested providers correctly", () => {
      render(
        <CopilotChatConfigurationProvider
          threadId="outer-thread"
          agentId="outer-agent"
          labels={{ chatInputPlaceholder: "Outer" }}
        >
          <CopilotChatConfigurationProvider
            threadId="middle-thread"
            agentId="middle-agent"
            labels={{ chatInputPlaceholder: "Middle" }}
          >
            <CopilotChatConfigurationProvider
              threadId="inner-thread"
              agentId="inner-agent"
              labels={{ chatInputPlaceholder: "Inner" }}
            >
              <ConfigurationDisplay />
            </CopilotChatConfigurationProvider>
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>,
      );

      // Innermost provider should win
      expect(screen.getByTestId("agentId").textContent).toBe("inner-agent");
      expect(screen.getByTestId("threadId").textContent).toBe("inner-thread");
      expect(screen.getByTestId("placeholder").textContent).toBe("Inner");
    });
  });
});
