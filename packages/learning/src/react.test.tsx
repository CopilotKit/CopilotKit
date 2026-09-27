import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { LearningProvider } from "./react";
import { startProductInteractionCapture } from "./capture";
import type { ProductInteractionEvent } from "./types";

vi.mock("./capture", () => ({
  startProductInteractionCapture: vi.fn(() => vi.fn()),
}));
const capture = vi.mocked(startProductInteractionCapture);
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.clearAllMocks());

describe("LearningProvider", () => {
  it("keeps capture stable across callback/array rerenders and removes it on unmount", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const first = vi.fn();
    const second = vi.fn();
    await act(async () =>
      root.render(
        <LearningProvider onEvent={first} apiUrlPrefixes={["/api"]}>
          <button>Save</button>
        </LearningProvider>,
      ),
    );
    expect(container.textContent).toBe("Save");
    expect(capture).toHaveBeenCalledTimes(1);
    const event: ProductInteractionEvent = {
      id: "1",
      actionId: "1",
      timestamp: 1,
      type: "interaction",
      action: "click",
      target: { tagName: "button" },
    };
    capture.mock.calls[0][0].onEvent(event);
    expect(first).toHaveBeenCalledWith(event);
    await act(async () =>
      root.render(
        <LearningProvider onEvent={second} apiUrlPrefixes={["/api"]} />,
      ),
    );
    expect(capture).toHaveBeenCalledTimes(1);
    capture.mock.calls[0][0].onEvent(event);
    expect(second).toHaveBeenCalledWith(event);
    await act(async () => root.unmount());
    expect(capture.mock.results[0].value).toHaveBeenCalledOnce();
  });

  it("replaces capture when privacy options change", async () => {
    const root = createRoot(document.createElement("div"));
    const onEvent = vi.fn();
    await act(async () => root.render(<LearningProvider onEvent={onEvent} />));
    const cleanup = capture.mock.results[0].value;
    await act(async () =>
      root.render(
        <LearningProvider
          onEvent={onEvent}
          enabled={false}
          captureContext={false}
          excludedUrlPrefixes={["/api/runtime"]}
        />,
      ),
    );
    expect(cleanup).toHaveBeenCalledOnce();
    expect(capture.mock.calls[1][0].enabled).toBe(false);
    expect(capture.mock.calls[1][0].captureContext).toBe(false);
    expect(capture.mock.calls[1][0].excludedUrlPrefixes).toEqual([
      "/api/runtime",
    ]);
    await act(async () => root.unmount());
  });
});
