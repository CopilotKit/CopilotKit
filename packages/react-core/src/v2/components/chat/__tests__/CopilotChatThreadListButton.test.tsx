import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { CopilotChatThreadListButton } from "../CopilotChatThreadListButton";
import { CopilotModalHeader } from "../CopilotModalHeader";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../../providers/CopilotChatConfigurationProvider";

function ModalStateReadout() {
  const config = useCopilotChatConfiguration();
  return <div data-testid="modalState">{config?.modalState}</div>;
}

test("clicking the launcher transitions the provider state to threads", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen>
      <CopilotChatThreadListButton />
      <ModalStateReadout />
    </CopilotChatConfigurationProvider>,
  );

  expect(screen.getByTestId("modalState").textContent).toBe("chat");

  act(() => {
    fireEvent.click(screen.getByTestId("copilot-thread-list-button"));
  });

  expect(screen.getByTestId("modalState").textContent).toBe("threads");
});

test("launcher reflects threads state via data-state and aria-pressed", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen>
      <CopilotChatThreadListButton />
    </CopilotChatConfigurationProvider>,
  );

  const button = screen.getByTestId("copilot-thread-list-button");
  expect(button.getAttribute("data-state")).toBe("closed");
  expect(button.getAttribute("aria-pressed")).toBe("false");

  act(() => {
    fireEvent.click(button);
  });

  expect(button.getAttribute("data-state")).toBe("open");
  expect(button.getAttribute("aria-pressed")).toBe("true");
});

test("custom onClick fires and can prevent the threads transition", () => {
  const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());

  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen>
      <CopilotChatThreadListButton onClick={onClick} />
      <ModalStateReadout />
    </CopilotChatConfigurationProvider>,
  );

  act(() => {
    fireEvent.click(screen.getByTestId("copilot-thread-list-button"));
  });

  expect(onClick).toHaveBeenCalledTimes(1);
  // preventDefault stops the default threads transition.
  expect(screen.getByTestId("modalState").textContent).toBe("chat");
});

test("disabled launcher does not transition state", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen>
      <CopilotChatThreadListButton disabled />
      <ModalStateReadout />
    </CopilotChatConfigurationProvider>,
  );

  const button = screen.getByTestId("copilot-thread-list-button");
  expect(button.hasAttribute("disabled")).toBe(true);

  act(() => {
    fireEvent.click(button);
  });

  expect(screen.getByTestId("modalState").textContent).toBe("chat");
});

test("launcher renders in the chat header and opens the threads panel on click", () => {
  // The launcher is opt-in: it renders only when the consumer supplies the
  // `threadListButton` slot (passing `{}` selects the default launcher).
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen>
      <CopilotModalHeader title="Chat" threadListButton={{}} />
      <ModalStateReadout />
    </CopilotChatConfigurationProvider>,
  );

  const header = document.querySelector('[data-slot="copilot-modal-header"]');
  expect(header).not.toBeNull();

  const launcher = screen.getByTestId("copilot-thread-list-button");
  expect(header?.contains(launcher)).toBe(true);

  act(() => {
    fireEvent.click(launcher);
  });

  expect(screen.getByTestId("modalState").textContent).toBe("threads");
});

test("header threadListButton slot can be overridden", () => {
  render(
    <CopilotChatConfigurationProvider threadId="t" isModalDefaultOpen>
      <CopilotModalHeader
        title="Chat"
        threadListButton={{ "data-testid": "custom-launcher" } as never}
      />
    </CopilotChatConfigurationProvider>,
  );

  expect(screen.queryByTestId("custom-launcher")).not.toBeNull();
});
