import { describe, expect, it, vi } from "vitest";
import {
  ɵComposerController,
  ɵflattenToolsMenuForDisplay,
  ɵnormalizeToolsMenu,
  ɵshowsComposerDisclaimer,
  ɵsyncRecorderToMode,
} from "../composer";
import type { ɵComposerInput, ɵModeRecorder } from "../composer";

interface MenuItem {
  label: string;
  action?: () => void;
  items?: (MenuItem | "-")[];
}

const command = (label: string, action: () => void = () => {}): MenuItem => ({
  label,
  action,
});

const labels = (menu: readonly (MenuItem | "-")[]) =>
  menu.map((item) => (item === "-" ? "-" : item.label));

const key = (k: string) => ({ key: k, shiftKey: false, isComposing: false });

const input = (value: string): ɵComposerInput => ({
  value,
  isRunning: false,
  canSubmit: true,
  canStop: true,
});

describe("ɵnormalizeToolsMenu", () => {
  it("puts the add-file item first, with a separator before the app's items", () => {
    const menu = ɵnormalizeToolsMenu(
      [command("Search"), command("Summarize")],
      command("Add file"),
    );
    expect(labels(menu)).toEqual(["Add file", "-", "Search", "Summarize"]);
  });

  it("merges repeated separators and drops them at the start and end", () => {
    const menu = ɵnormalizeToolsMenu([
      "-",
      command("Search"),
      "-",
      "-",
      command("Summarize"),
      "-",
    ]);
    expect(labels(menu)).toEqual(["Search", "-", "Summarize"]);
  });

  it("drops the separator after add-file when the app has no items", () => {
    expect(labels(ɵnormalizeToolsMenu(["-"], command("Add file")))).toEqual([
      "Add file",
    ]);
    expect(ɵnormalizeToolsMenu(undefined)).toEqual([]);
  });
});

describe("ɵflattenToolsMenuForDisplay", () => {
  it("draws groups as a label with their items one level deeper", () => {
    const search = vi.fn();
    const rows = ɵflattenToolsMenuForDisplay<MenuItem>([
      command("Attach"),
      "-",
      { label: "More", items: [command("Search", search), { label: "Empty" }] },
    ]);

    expect(
      rows.map((row) =>
        row.type === "separator" ? "-" : `${row.depth}:${row.label}`,
      ),
    ).toEqual(["0:Attach", "-", "0:More", "1:Search"]);
    const searchRow = rows[3];
    if (searchRow?.type !== "item") throw new Error("expected an item row");
    searchRow.action();
    expect(search).toHaveBeenCalledOnce();
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
});

describe("ɵsyncRecorderToMode", () => {
  const recorder = (state: string): ɵModeRecorder => ({
    state,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  });

  it("starts an idle recorder in transcribe mode", async () => {
    const idle = recorder("idle");
    await ɵsyncRecorderToMode(idle, "transcribe");
    expect(idle.start).toHaveBeenCalledOnce();
  });

  it("does not start a recorder that already records", async () => {
    const recording = recorder("recording");
    await ɵsyncRecorderToMode(recording, "transcribe");
    expect(recording.start).not.toHaveBeenCalled();
    expect(recording.stop).not.toHaveBeenCalled();
  });

  it("stops a recording recorder when the mode leaves transcribe", async () => {
    const recording = recorder("recording");
    await ɵsyncRecorderToMode(recording, "input");
    expect(recording.stop).toHaveBeenCalledOnce();
  });

  it("logs a recorder error instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = recorder("idle");
    const denied = new Error("denied");
    vi.mocked(failing.start).mockRejectedValue(denied);
    try {
      await expect(
        ɵsyncRecorderToMode(failing, "transcribe"),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(denied);
    } finally {
      error.mockRestore();
    }
  });
});

describe("ɵshowsComposerDisclaimer", () => {
  it("follows showDisclaimer, else shows only for absolute positioning", () => {
    expect(ɵshowsComposerDisclaimer({ positioning: "absolute" })).toBe(true);
    expect(ɵshowsComposerDisclaimer({ positioning: "static" })).toBe(false);
    expect(
      ɵshowsComposerDisclaimer({
        showDisclaimer: false,
        positioning: "absolute",
      }),
    ).toBe(false);
    expect(ɵshowsComposerDisclaimer({ showDisclaimer: true })).toBe(true);
  });
});

describe("ɵComposerController", () => {
  const menu: (MenuItem | "-")[] = [
    command("Summarize"),
    command("Search"),
    command("Translate"),
  ];

  const create = (options: { value?: string; initialValue?: string } = {}) => {
    const onChange = vi.fn();
    const composer = new ɵComposerController<MenuItem>({
      initialValue: options.initialValue,
      onChange,
    });
    composer.setInputs({ value: options.value, mode: "input", menu });
    return { composer, onChange };
  };

  describe("text", () => {
    it("keeps the text itself and reports each change when uncontrolled", () => {
      const { composer, onChange } = create({ initialValue: "hi" });
      expect(composer.getSnapshot().value).toBe("hi");

      composer.setValue("hello");

      expect(composer.getSnapshot().value).toBe("hello");
      expect(onChange).toHaveBeenCalledWith("hello");
    });

    it("shows the app's value when controlled, and only reports typing", () => {
      const { composer, onChange } = create({ value: "app" });

      composer.setValue("typed");

      expect(composer.getSnapshot().value).toBe("app");
      expect(onChange).toHaveBeenCalledWith("typed");
    });

    it("sends the trimmed text and then clears it", () => {
      const { composer, onChange } = create({ initialValue: "  hi  " });
      const send = vi.fn(() => {
        // The input still holds the text while the app handles the send.
        expect(composer.getSnapshot().value).toBe("  hi  ");
      });

      expect(composer.submit(send)).toBe(true);

      expect(send).toHaveBeenCalledWith("hi");
      expect(composer.getSnapshot().value).toBe("");
      expect(onChange).toHaveBeenLastCalledWith("");
    });

    it("sends nothing for whitespace, and can keep the text", () => {
      const { composer } = create({ initialValue: "   " });
      const send = vi.fn();
      expect(composer.submit(send)).toBe(false);
      expect(send).not.toHaveBeenCalled();

      composer.setValue("keep");
      composer.submit(send, { clear: false });
      expect(composer.getSnapshot().value).toBe("keep");
    });

    it("sends a newer value than the snapshot when given one", () => {
      const { composer } = create({ value: "old" });
      const send = vi.fn();
      composer.submit(send, { value: "new " });
      expect(send).toHaveBeenCalledWith("new");
    });
  });

  describe("slash menu", () => {
    it("opens for text starting with / and filters the commands", () => {
      const { composer } = create();
      composer.setValue("/s");

      const state = composer.getSnapshot();
      expect(state.slashQuery).toBe("s");
      expect(labels(state.slashCommands)).toEqual([
        "Summarize",
        "Search",
        "Translate",
      ]);
      expect(state.slashHighlightIndex).toBe(0);
    });

    it("stays closed without commands", () => {
      const composer = new ɵComposerController<MenuItem>();
      composer.setInputs({ value: undefined, mode: "input", menu: [] });
      composer.setValue("/s");
      expect(composer.getSnapshot().slashQuery).toBeNull();
    });

    it("moves the highlight with the arrows and resets it when the query changes", () => {
      const { composer } = create();
      composer.setValue("/");

      const down = composer.keyDown(key("ArrowDown"), input("/"));
      expect(down).toEqual({ preventDefault: true, action: "none" });
      expect(composer.getSnapshot().slashHighlightIndex).toBe(1);

      composer.setValue("/s");
      expect(composer.getSnapshot().slashHighlightIndex).toBe(0);
    });

    it("keeps the highlight on a row that exists when the list shrinks", () => {
      const { composer } = create();
      composer.setValue("/");
      composer.highlight(2);
      composer.setInputs({
        value: undefined,
        mode: "input",
        menu: [command("Summarize")],
      });
      expect(composer.getSnapshot().slashHighlightIndex).toBe(0);
    });

    it("has no highlight when nothing matches", () => {
      const { composer } = create();
      composer.setValue("/zzz");
      expect(composer.getSnapshot().slashCommands).toEqual([]);
      expect(composer.getSnapshot().slashHighlightIndex).toBe(-1);
    });

    it("runs the highlighted command on Enter and clears the text", () => {
      const translate = vi.fn();
      const { composer, onChange } = create();
      composer.setInputs({
        value: undefined,
        mode: "input",
        menu: [command("Translate", translate)],
      });
      composer.setValue("/tr");

      const result = composer.keyDown(key("Enter"), input("/tr"));

      expect(result).toEqual({ preventDefault: true, action: "command" });
      expect(translate).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenLastCalledWith("");
      expect(composer.getSnapshot()).toMatchObject({
        value: "",
        slashQuery: null,
      });
    });

    it("closes on Escape until the text changes", () => {
      const { composer } = create();
      composer.setValue("/s");

      composer.keyDown(key("Escape"), input("/s"));
      expect(composer.getSnapshot().slashQuery).toBeNull();
      expect(composer.getSnapshot().value).toBe("/s");

      composer.setValue("/se");
      expect(composer.getSnapshot().slashQuery).toBe("se");
    });

    it("closes when the mode leaves input, until the text changes", () => {
      const { composer } = create();
      composer.setValue("/s");
      composer.setInputs({ value: undefined, mode: "transcribe", menu });
      expect(composer.getSnapshot().slashQuery).toBeNull();

      composer.setInputs({ value: undefined, mode: "input", menu });
      expect(composer.getSnapshot().slashQuery).toBeNull();
      composer.setValue("/");
      expect(composer.getSnapshot().slashQuery).toBe("");
    });

    it("stays closed for a controlled value that a command did not clear", () => {
      const { composer } = create({ value: "/s" });
      composer.runCommand(command("Search"));
      expect(composer.getSnapshot().slashQuery).toBeNull();
    });
  });

  describe("keys", () => {
    it("ignores keys during IME composition", () => {
      const { composer } = create();
      composer.setValue("/s");
      expect(
        composer.keyDown(
          { ...key("ArrowDown"), isComposing: true },
          input("/s"),
        ),
      ).toEqual({ preventDefault: false, action: "none" });
      expect(composer.getSnapshot().slashHighlightIndex).toBe(0);
    });

    it("sends on Enter when the slash menu is closed", () => {
      const { composer } = create();
      composer.setValue("hello");
      expect(composer.keyDown(key("Enter"), input("hello"))).toEqual({
        preventDefault: true,
        action: "send",
      });
    });
  });

  it("notifies only when the state changes", () => {
    const { composer } = create();
    const listener = vi.fn();
    composer.subscribe(listener);
    const before = composer.getSnapshot();

    composer.setInputs({ value: undefined, mode: "input", menu });

    expect(listener).not.toHaveBeenCalled();
    expect(composer.getSnapshot()).toBe(before);
  });
});
