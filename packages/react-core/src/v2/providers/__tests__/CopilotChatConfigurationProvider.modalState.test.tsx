import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { test, expect } from "vitest";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
  isModalStateOpen,
  modalStateFromBoolean,
  type CopilotChatModalState,
} from "../CopilotChatConfigurationProvider";

// Probe that reads the closest provider and exposes the tri-state + the
// backward-compat boolean, plus buttons to drive each transition path.
function ModalStateProbe({ id = "probe" }: { id?: string } = {}) {
  const config = useCopilotChatConfiguration();
  return (
    <>
      <div data-testid={`${id}-modalState`}>{config?.modalState}</div>
      <div data-testid={`${id}-isModalOpen`}>{String(config?.isModalOpen)}</div>
      <button
        data-testid={`${id}-set-none`}
        onClick={() => config?.setModalState("none")}
      >
        none
      </button>
      <button
        data-testid={`${id}-set-chat`}
        onClick={() => config?.setModalState("chat")}
      >
        chat
      </button>
      <button
        data-testid={`${id}-set-threads`}
        onClick={() => config?.setModalState("threads")}
      >
        threads
      </button>
      <button
        data-testid={`${id}-open-bool`}
        onClick={() => config?.setModalOpen(true)}
      >
        open
      </button>
      <button
        data-testid={`${id}-close-bool`}
        onClick={() => config?.setModalOpen(false)}
      >
        close
      </button>
    </>
  );
}

test("pure helper: isModalStateOpen treats chat and threads as open, none as closed", () => {
  expect(isModalStateOpen("none")).toBe(false);
  expect(isModalStateOpen("chat")).toBe(true);
  expect(isModalStateOpen("threads")).toBe(true);
});

test("pure helper: modalStateFromBoolean maps open=false to none and open=true to chat from none", () => {
  expect(modalStateFromBoolean(false, "chat")).toBe("none");
  expect(modalStateFromBoolean(false, "threads")).toBe("none");
  expect(modalStateFromBoolean(true, "none")).toBe("chat");
});

test("pure helper: modalStateFromBoolean open=true preserves an already-open threads panel", () => {
  // A boolean "open" must not steal focus away from an intentionally-open
  // thread list — it keeps whatever non-none panel is showing.
  expect(modalStateFromBoolean(true, "threads")).toBe("threads");
  expect(modalStateFromBoolean(true, "chat")).toBe("chat");
});

test("default open maps to the chat tri-state", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t">
      <ModalStateProbe />
    </CopilotChatConfigurationProvider>,
  );

  expect(screen.getByTestId("probe-modalState").textContent).toBe("chat");
  expect(screen.getByTestId("probe-isModalOpen").textContent).toBe("true");
});

test("isModalDefaultOpen={false} maps to the none tri-state", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen={false}>
      <ModalStateProbe />
    </CopilotChatConfigurationProvider>,
  );

  expect(screen.getByTestId("probe-modalState").textContent).toBe("none");
  expect(screen.getByTestId("probe-isModalOpen").textContent).toBe("false");
});

test("setModalState transitions none -> chat -> threads -> none", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen={false}>
      <ModalStateProbe />
    </CopilotChatConfigurationProvider>,
  );

  expect(screen.getByTestId("probe-modalState").textContent).toBe("none");

  act(() => {
    fireEvent.click(screen.getByTestId("probe-set-chat"));
  });
  expect(screen.getByTestId("probe-modalState").textContent).toBe("chat");
  expect(screen.getByTestId("probe-isModalOpen").textContent).toBe("true");

  act(() => {
    fireEvent.click(screen.getByTestId("probe-set-threads"));
  });
  expect(screen.getByTestId("probe-modalState").textContent).toBe("threads");
  expect(screen.getByTestId("probe-isModalOpen").textContent).toBe("true");

  act(() => {
    fireEvent.click(screen.getByTestId("probe-set-none"));
  });
  expect(screen.getByTestId("probe-modalState").textContent).toBe("none");
  expect(screen.getByTestId("probe-isModalOpen").textContent).toBe("false");
});

test("chat and threads are mutually exclusive — only one is ever the state", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen={false}>
      <ModalStateProbe />
    </CopilotChatConfigurationProvider>,
  );

  act(() => {
    fireEvent.click(screen.getByTestId("probe-set-threads"));
  });
  expect(screen.getByTestId("probe-modalState").textContent).toBe("threads");

  // Switching to chat fully replaces threads (never both).
  act(() => {
    fireEvent.click(screen.getByTestId("probe-set-chat"));
  });
  const state: CopilotChatModalState = screen.getByTestId("probe-modalState")
    .textContent as CopilotChatModalState;
  expect(state).toBe("chat");
});

test("backward compat: setModalOpen(false) closes from threads to none", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen={false}>
      <ModalStateProbe />
    </CopilotChatConfigurationProvider>,
  );

  act(() => {
    fireEvent.click(screen.getByTestId("probe-set-threads"));
  });
  expect(screen.getByTestId("probe-isModalOpen").textContent).toBe("true");

  act(() => {
    fireEvent.click(screen.getByTestId("probe-close-bool"));
  });
  expect(screen.getByTestId("probe-modalState").textContent).toBe("none");
  expect(screen.getByTestId("probe-isModalOpen").textContent).toBe("false");
});

test("backward compat: setModalOpen(true) opens the chat panel from none", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen={false}>
      <ModalStateProbe />
    </CopilotChatConfigurationProvider>,
  );

  act(() => {
    fireEvent.click(screen.getByTestId("probe-open-bool"));
  });
  expect(screen.getByTestId("probe-modalState").textContent).toBe("chat");
  expect(screen.getByTestId("probe-isModalOpen").textContent).toBe("true");
});

test("backward compat: setModalOpen(true) keeps threads open rather than stealing to chat", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen={false}>
      <ModalStateProbe />
    </CopilotChatConfigurationProvider>,
  );

  act(() => {
    fireEvent.click(screen.getByTestId("probe-set-threads"));
  });

  act(() => {
    fireEvent.click(screen.getByTestId("probe-open-bool"));
  });
  expect(screen.getByTestId("probe-modalState").textContent).toBe("threads");
});

test("tri-state syncs inner -> outer (Behavior B) including the threads transition", () => {
  render(
    <CopilotChatConfigurationProvider threadId="outer">
      <ModalStateProbe id="outer" />
      <CopilotChatConfigurationProvider threadId="inner" isModalDefaultOpen>
        <ModalStateProbe id="inner" />
      </CopilotChatConfigurationProvider>
    </CopilotChatConfigurationProvider>,
  );

  act(() => {
    fireEvent.click(screen.getByTestId("inner-set-threads"));
  });

  expect(screen.getByTestId("inner-modalState").textContent).toBe("threads");
  expect(screen.getByTestId("outer-modalState").textContent).toBe("threads");
});

test("tri-state syncs outer -> inner (parent->child)", () => {
  render(
    <CopilotChatConfigurationProvider
      threadId="outer"
      isModalDefaultOpen={false}
    >
      <ModalStateProbe id="outer" />
      <CopilotChatConfigurationProvider
        threadId="inner"
        isModalDefaultOpen={false}
      >
        <ModalStateProbe id="inner" />
      </CopilotChatConfigurationProvider>
    </CopilotChatConfigurationProvider>,
  );

  act(() => {
    fireEvent.click(screen.getByTestId("outer-set-threads"));
  });

  expect(screen.getByTestId("outer-modalState").textContent).toBe("threads");
  expect(screen.getByTestId("inner-modalState").textContent).toBe("threads");
});
