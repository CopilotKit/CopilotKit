import React, { createRef } from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  const snapToIndex = vi.fn();
  const close = vi.fn();

  return {
    snapToIndex,
    close,
    lastOnClose: null as (() => void) | null,
    lastSnapPoints: null as (string | number)[] | null,
    lastIndex: null as number | null,
  };
});

// Mock react-native primitives used in CopilotModal
vi.mock("react-native", () => ({
  StyleSheet: {
    create: (s: Record<string, unknown>) => s,
  },
  View: "View",
}));

// Mock @gorhom/bottom-sheet
vi.mock("@gorhom/bottom-sheet", () => {
  const React = require("react");

  // BottomSheet stores its ref and captures props for assertions
  const BottomSheet = React.forwardRef(function MockBottomSheet(
    props: any,
    ref: any,
  ) {
    React.useImperativeHandle(ref, () => ({
      snapToIndex: hoisted.snapToIndex,
      close: hoisted.close,
    }));

    hoisted.lastOnClose = props.onClose ?? null;
    hoisted.lastSnapPoints = props.snapPoints ?? null;
    hoisted.lastIndex = props.index ?? null;

    return React.createElement(
      "mock-bottom-sheet",
      { "data-testid": "bottom-sheet" },
      props.children,
    );
  });

  const BottomSheetView = (props: any) =>
    React.createElement(
      "mock-bottom-sheet-view",
      { "data-testid": "bottom-sheet-view" },
      props.children,
    );

  const BottomSheetBackdrop = (props: any) =>
    React.createElement("mock-backdrop", props);

  const BottomSheetFlatList = (props: any) =>
    React.createElement(
      "mock-bottom-sheet-flatlist",
      { "data-testid": "bottom-sheet-flatlist" },
      props.children,
    );

  return {
    __esModule: true,
    default: BottomSheet,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetFlatList,
  };
});

// Mock CopilotChat (B4's component — may not exist yet in this worktree)
vi.mock("../CopilotChat", () => {
  const React = require("react");
  const CopilotChat = (props: any) =>
    React.createElement("mock-copilot-chat", {
      "data-testid": "copilot-chat",
      ...props,
    });
  return { CopilotChat };
});

// Import after mocks
import { CopilotModal } from "../CopilotModal";
import type { CopilotModalRef } from "../CopilotModal";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CopilotModal", () => {
  beforeEach(() => {
    hoisted.snapToIndex.mockClear();
    hoisted.close.mockClear();
    hoisted.lastOnClose = null;
    hoisted.lastSnapPoints = null;
    hoisted.lastIndex = null;
  });

  // ── Rendering ───────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the bottom sheet with default snap points", () => {
      render(<CopilotModal />);

      expect(hoisted.lastSnapPoints).toEqual(["50%", "90%"]);
    });

    it("starts closed (index -1)", () => {
      render(<CopilotModal />);

      expect(hoisted.lastIndex).toBe(-1);
    });

    it("embeds CopilotChat inside the sheet", () => {
      const { getByTestId } = render(<CopilotModal />);

      expect(getByTestId("copilot-chat")).toBeTruthy();
    });
  });

  // ── Controlled visibility ─────────────────────────────────────────────

  describe("controlled visibility", () => {
    it("opens the sheet when visible becomes true", () => {
      const { rerender } = render(<CopilotModal visible={false} />);

      rerender(<CopilotModal visible={true} />);

      expect(hoisted.snapToIndex).toHaveBeenCalledWith(0);
    });

    it("closes the sheet when visible becomes false", () => {
      const { rerender } = render(<CopilotModal visible={true} />);

      hoisted.snapToIndex.mockClear();

      rerender(<CopilotModal visible={false} />);

      expect(hoisted.close).toHaveBeenCalled();
    });
  });

  // ── onDismiss ─────────────────────────────────────────────────────────

  describe("onDismiss", () => {
    it("calls onDismiss when the sheet closes", () => {
      const onDismiss = vi.fn();
      render(<CopilotModal onDismiss={onDismiss} />);

      // Simulate bottom-sheet calling onClose
      act(() => {
        hoisted.lastOnClose?.();
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("does not call onDismiss when enableDismissOnClose is false", () => {
      const onDismiss = vi.fn();
      render(
        <CopilotModal onDismiss={onDismiss} enableDismissOnClose={false} />,
      );

      act(() => {
        hoisted.lastOnClose?.();
      });

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  // ── Custom snap points ────────────────────────────────────────────────

  describe("custom snap points", () => {
    it("uses provided snap points", () => {
      render(<CopilotModal snapPoints={["25%", "75%", "100%"]} />);

      expect(hoisted.lastSnapPoints).toEqual(["25%", "75%", "100%"]);
    });

    it("opens at the specified initialSnapIndex", () => {
      const ref = createRef<CopilotModalRef>();
      render(<CopilotModal ref={ref} initialSnapIndex={1} />);

      act(() => {
        ref.current?.open();
      });

      expect(hoisted.snapToIndex).toHaveBeenCalledWith(1);
    });
  });

  // ── Imperative API ────────────────────────────────────────────────────

  describe("imperative API", () => {
    it("exposes open() via ref", () => {
      const ref = createRef<CopilotModalRef>();
      render(<CopilotModal ref={ref} />);

      act(() => {
        ref.current?.open();
      });

      expect(hoisted.snapToIndex).toHaveBeenCalledWith(0);
    });

    it("exposes close() via ref", () => {
      const ref = createRef<CopilotModalRef>();
      render(<CopilotModal ref={ref} />);

      act(() => {
        ref.current?.close();
      });

      expect(hoisted.close).toHaveBeenCalled();
    });
  });

  // ── CopilotChat pass-through ──────────────────────────────────────────

  describe("CopilotChat integration", () => {
    it("passes agentName to CopilotChat", () => {
      const { getByTestId } = render(<CopilotModal agentName="test-agent" />);

      const chat = getByTestId("copilot-chat");
      expect(chat.getAttribute("agentName")).toBe("test-agent");
    });

    it("passes placeholder to CopilotChat", () => {
      const { getByTestId } = render(
        <CopilotModal placeholder="Ask me anything..." />,
      );

      const chat = getByTestId("copilot-chat");
      expect(chat.getAttribute("placeholder")).toBe("Ask me anything...");
    });

    it("passes headerTitle to CopilotChat", () => {
      const { getByTestId } = render(
        <CopilotModal headerTitle="AI Assistant" />,
      );

      const chat = getByTestId("copilot-chat");
      expect(chat.getAttribute("headerTitle")).toBe("AI Assistant");
    });
  });
});
