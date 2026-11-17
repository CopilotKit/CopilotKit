import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { fireEvent, render, screen } from "@testing-library/vue";
import CopilotTooltip from "../CopilotTooltip.vue";
import { computeFloatingPlacement } from "../floating";

function renderTooltip(props: Record<string, unknown> = {}) {
  return render(
    defineComponent({
      setup() {
        return () =>
          h(
            CopilotTooltip,
            { content: "Copy", side: "bottom", ...props },
            {
              default: ({
                triggerProps,
              }: {
                triggerProps: Record<string, unknown>;
              }) =>
                h("button", {
                  type: "button",
                  "aria-label": "Copy",
                  ...triggerProps,
                }),
            },
          );
      },
    }),
  );
}

const pointer = (type: string) =>
  Object.assign(new Event(type, { bubbles: true }), { pointerType: "mouse" });

describe("CopilotTooltip", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens on keyboard focus, describes the trigger, and closes on blur", async () => {
    renderTooltip();
    const button = screen.getByRole("button", { name: "Copy" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    await fireEvent.focus(button);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Copy");
    expect(tooltip.classList.contains("cpk-tooltip")).toBe(true);
    expect(tooltip.getAttribute("data-side")).toBe("bottom");
    expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);

    await fireEvent.blur(button);
    await nextTick();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBeNull();
  });

  it("opens on hover and closes when the pointer leaves", async () => {
    vi.useFakeTimers();
    renderTooltip();
    const button = screen.getByRole("button", { name: "Copy" });

    button.dispatchEvent(pointer("pointermove"));
    await nextTick();
    expect(screen.getByRole("tooltip")).toBeTruthy();

    button.dispatchEvent(pointer("pointerleave"));
    await vi.advanceTimersByTimeAsync(200);
    await nextTick();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes on Escape without moving focus", async () => {
    renderTooltip();
    const button = screen.getByRole("button", { name: "Copy" });
    button.focus();
    await fireEvent.focus(button);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    await fireEvent.keyDown(document, { key: "Escape" });
    await nextTick();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("stays closed while suppressed", async () => {
    const suppressed = ref(true);
    render(
      defineComponent({
        setup() {
          return () =>
            h(
              CopilotTooltip,
              { content: "Rate", suppressed: suppressed.value },
              {
                default: ({
                  triggerProps,
                }: {
                  triggerProps: Record<string, unknown>;
                }) => h("button", { type: "button", ...triggerProps }, "Rate"),
              },
            );
        },
      }),
    );
    const button = screen.getByRole("button", { name: "Rate" });
    await fireEvent.focus(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("computeFloatingPlacement", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 100, height: 40 };

  it("places content below and centered, with the offset", () => {
    const reference = {
      top: 100,
      bottom: 120,
      left: 200,
      right: 240,
      width: 40,
      height: 20,
    };
    const placement = computeFloatingPlacement(reference, size, viewport, {
      side: "bottom",
      sideOffset: 4,
      arrowSize: 10,
    });
    expect(placement.side).toBe("bottom");
    expect(placement.y).toBe(134);
    expect(placement.x).toBe(170);
  });

  it("flips to the other side when there is no room", () => {
    const reference = {
      top: 770,
      bottom: 790,
      left: 200,
      right: 240,
      width: 40,
      height: 20,
    };
    const placement = computeFloatingPlacement(reference, size, viewport, {
      side: "bottom",
    });
    expect(placement.side).toBe("top");
    expect(placement.y).toBe(730);
  });

  it("shifts content back inside the viewport", () => {
    const reference = {
      top: 100,
      bottom: 120,
      left: 0,
      right: 20,
      width: 20,
      height: 20,
    };
    const placement = computeFloatingPlacement(reference, size, viewport, {
      side: "bottom",
      collisionPadding: 8,
    });
    expect(placement.x).toBe(8);
  });
});
