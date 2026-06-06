import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatSuggestionView } from "../copilot-chat-suggestion-view";
import { CopilotChatSuggestionPill } from "../copilot-chat-suggestion-pill";
import type { Suggestion } from "../copilot-chat-suggestion-view.types";

function makeSuggestions(): Suggestion[] {
  return [
    { title: "Suggestion 1", message: "Message 1", isLoading: false },
    { title: "Suggestion 2", message: "Message 2", isLoading: false },
    { title: "Suggestion 3", message: "Message 3", isLoading: false },
  ];
}

interface ViewBindings {
  suggestions: ReturnType<typeof signal<Suggestion[]>>;
  loadingIndexes: ReturnType<typeof signal<ReadonlyArray<number> | undefined>>;
  inputClass: ReturnType<typeof signal<string | undefined>>;
}

function buildView(initial: {
  suggestions?: Suggestion[];
  loadingIndexes?: ReadonlyArray<number>;
  inputClass?: string;
}): { component: CopilotChatSuggestionView; bindings: ViewBindings } {
  const injector = TestBed.inject(EnvironmentInjector);
  const component = runInInjectionContext(
    injector,
    () => new CopilotChatSuggestionView(),
  );

  const bindings: ViewBindings = {
    suggestions: signal(initial.suggestions ?? []),
    loadingIndexes: signal(initial.loadingIndexes),
    inputClass: signal(initial.inputClass),
  };

  (component as unknown as { suggestions: () => Suggestion[] }).suggestions =
    () => bindings.suggestions();
  (
    component as unknown as {
      loadingIndexes: () => ReadonlyArray<number> | undefined;
    }
  ).loadingIndexes = () => bindings.loadingIndexes();
  (
    component as unknown as { inputClass: () => string | undefined }
  ).inputClass = () => bindings.inputClass();

  return { component, bindings };
}

describe("CopilotChatSuggestionView", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it("produces one pill entry per suggestion with title as children", () => {
    const suggestions = makeSuggestions();
    const { component } = buildView({ suggestions });

    const entries = component.pillEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0].context.children).toBe("Suggestion 1");
    expect(entries[1].context.children).toBe("Suggestion 2");
    expect(entries[2].context.children).toBe("Suggestion 3");
  });

  it("returns an empty pill list for empty suggestions", () => {
    const { component } = buildView({ suggestions: [] });
    expect(component.pillEntries()).toEqual([]);
  });

  it("uses a stable key per suggestion derived from title and index", () => {
    const suggestions = makeSuggestions();
    const { component } = buildView({ suggestions });
    const keys = component.pillEntries().map((p) => p.key);
    expect(keys).toEqual([
      "Suggestion 1-0",
      "Suggestion 2-1",
      "Suggestion 3-2",
    ]);
  });

  it("defaults pill type to 'button'", () => {
    const { component } = buildView({ suggestions: makeSuggestions() });
    component.pillEntries().forEach((entry) => {
      expect(entry.context.type).toBe("button");
    });
  });

  it("forwards suggestion.className through inputClass on each pill context", () => {
    const suggestions: Suggestion[] = [
      {
        title: "Styled",
        message: "Msg",
        isLoading: false,
        className: "bg-blue-500",
      },
    ];
    const { component } = buildView({ suggestions });
    expect(component.pillEntries()[0].context.inputClass).toBe("bg-blue-500");
  });

  it("marks pills as loading when their index is in loadingIndexes", () => {
    const { component, bindings } = buildView({
      suggestions: makeSuggestions(),
    });
    bindings.loadingIndexes.set([0, 2]);

    const entries = component.pillEntries();
    expect(entries[0].context.isLoading).toBe(true);
    expect(entries[1].context.isLoading).toBe(false);
    expect(entries[2].context.isLoading).toBe(true);
  });

  it("marks a pill as loading when the suggestion itself has isLoading=true", () => {
    const suggestions: Suggestion[] = [
      { title: "A", message: "a", isLoading: true },
      { title: "B", message: "b", isLoading: false },
    ];
    const { component } = buildView({ suggestions });
    const entries = component.pillEntries();
    expect(entries[0].context.isLoading).toBe(true);
    expect(entries[1].context.isLoading).toBe(false);
  });

  it("falls back to an empty loading set when loadingIndexes is undefined or empty", () => {
    const { component, bindings } = buildView({
      suggestions: makeSuggestions(),
    });

    expect(component.loadingSet().size).toBe(0);

    bindings.loadingIndexes.set([]);
    expect(component.loadingSet().size).toBe(0);
  });

  it("emits selectSuggestion with suggestion + index when handleSelect is invoked", () => {
    const suggestions = makeSuggestions();
    const { component } = buildView({ suggestions });

    const spy = vi.fn();
    component.selectSuggestion.subscribe(spy);

    component.handleSelect(suggestions[1], 1);

    expect(spy).toHaveBeenCalledWith({
      suggestion: suggestions[1],
      index: 1,
    });
  });

  it("invokes handleSelect with the matching suggestion when a pill clickHandler runs", () => {
    const suggestions = makeSuggestions();
    const { component } = buildView({ suggestions });

    const spy = vi.fn();
    component.selectSuggestion.subscribe(spy);

    component.pillEntries()[2].context.clickHandler!();

    expect(spy).toHaveBeenCalledWith({
      suggestion: suggestions[2],
      index: 2,
    });
  });

  it("recomputes pill entries when the suggestions input changes", () => {
    const { component, bindings } = buildView({
      suggestions: makeSuggestions(),
    });
    expect(component.pillEntries()).toHaveLength(3);

    bindings.suggestions.set([
      { title: "Only", message: "only", isLoading: false },
    ]);
    expect(component.pillEntries()).toHaveLength(1);
    expect(component.pillEntries()[0].context.children).toBe("Only");
  });

  it("exposes container context with the current inputClass", () => {
    const { component, bindings } = buildView({ inputClass: "my-class" });
    expect(component.containerContext().inputClass).toBe("my-class");

    bindings.inputClass.set("other");
    expect(component.containerContext().inputClass).toBe("other");
  });
});

interface PillBindings {
  children: ReturnType<typeof signal<string>>;
  isLoading: ReturnType<typeof signal<boolean>>;
  disabled: ReturnType<typeof signal<boolean>>;
  type: ReturnType<typeof signal<"button" | "submit" | "reset" | undefined>>;
  inputClass: ReturnType<typeof signal<string | undefined>>;
  clickHandler: ReturnType<
    typeof signal<((event?: Event) => void) | undefined>
  >;
  icon: ReturnType<typeof signal<string | undefined>>;
}

function buildPill(initial: {
  children?: string;
  isLoading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  inputClass?: string;
  clickHandler?: (event?: Event) => void;
  icon?: string;
}): { component: CopilotChatSuggestionPill; bindings: PillBindings } {
  const injector = TestBed.inject(EnvironmentInjector);
  const component = runInInjectionContext(
    injector,
    () => new CopilotChatSuggestionPill(),
  );

  const bindings: PillBindings = {
    children: signal(initial.children ?? ""),
    isLoading: signal(initial.isLoading ?? false),
    disabled: signal(initial.disabled ?? false),
    type: signal(initial.type),
    inputClass: signal(initial.inputClass),
    clickHandler: signal(initial.clickHandler),
    icon: signal(initial.icon),
  };

  (component as unknown as { children: () => string }).children = () =>
    bindings.children();
  (component as unknown as { isLoading: () => boolean }).isLoading = () =>
    bindings.isLoading();
  (component as unknown as { disabled: () => boolean }).disabled = () =>
    bindings.disabled();
  (
    component as unknown as {
      type: () => "button" | "submit" | "reset" | undefined;
    }
  ).type = () => bindings.type();
  (
    component as unknown as { inputClass: () => string | undefined }
  ).inputClass = () => bindings.inputClass();
  (
    component as unknown as {
      clickHandler: () => ((event?: Event) => void) | undefined;
    }
  ).clickHandler = () => bindings.clickHandler();
  (component as unknown as { icon: () => string | undefined }).icon = () =>
    bindings.icon();

  return { component, bindings };
}

describe("CopilotChatSuggestionPill", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
  });

  it("defaults the resolved type to 'button' when no type is provided", () => {
    const { component } = buildPill({});
    expect(component.resolvedType()).toBe("button");
  });

  it("respects an explicitly provided type", () => {
    const { component } = buildPill({ type: "submit" });
    expect(component.resolvedType()).toBe("submit");
  });

  it("isDisabled is true when isLoading is true", () => {
    const { component } = buildPill({ isLoading: true });
    expect(component.isDisabled()).toBe(true);
  });

  it("isDisabled is true when disabled input is true", () => {
    const { component } = buildPill({ disabled: true });
    expect(component.isDisabled()).toBe(true);
  });

  it("isDisabled is false when neither loading nor disabled", () => {
    const { component } = buildPill({});
    expect(component.isDisabled()).toBe(false);
  });

  it("showIcon is false when loading", () => {
    const { component } = buildPill({ isLoading: true, icon: "*" });
    expect(component.showIcon()).toBe(false);
  });

  it("showIcon is true when not loading and an icon is provided", () => {
    const { component } = buildPill({ icon: "*" });
    expect(component.showIcon()).toBe(true);
  });

  it("showIcon is false when no icon is provided", () => {
    const { component } = buildPill({});
    expect(component.showIcon()).toBe(false);
  });

  it("computedClass merges inputClass with the base classes", () => {
    const { component } = buildPill({ inputClass: "extra-class" });
    const cls = component.computedClass();
    expect(cls).toContain("extra-class");
    expect(cls).toContain("rounded-full");
  });

  it("invokes the provided clickHandler and emits clicked when handleClick runs", () => {
    const handler = vi.fn();
    const emitted = vi.fn();
    const { component } = buildPill({ clickHandler: handler });
    component.clicked.subscribe(emitted);

    const evt = new Event("click");
    component.handleClick(evt);

    expect(handler).toHaveBeenCalledWith(evt);
    expect(emitted).toHaveBeenCalledWith(evt);
  });

  it("does not invoke clickHandler or emit clicked when disabled", () => {
    const handler = vi.fn();
    const emitted = vi.fn();
    const { component } = buildPill({
      clickHandler: handler,
      disabled: true,
    });
    component.clicked.subscribe(emitted);

    component.handleClick(new Event("click"));

    expect(handler).not.toHaveBeenCalled();
    expect(emitted).not.toHaveBeenCalled();
  });

  it("does not invoke clickHandler or emit clicked when isLoading", () => {
    const handler = vi.fn();
    const emitted = vi.fn();
    const { component } = buildPill({
      clickHandler: handler,
      isLoading: true,
    });
    component.clicked.subscribe(emitted);

    component.handleClick(new Event("click"));

    expect(handler).not.toHaveBeenCalled();
    expect(emitted).not.toHaveBeenCalled();
  });

  it("emits clicked even when no clickHandler is provided", () => {
    const emitted = vi.fn();
    const { component } = buildPill({});
    component.clicked.subscribe(emitted);

    const evt = new Event("click");
    component.handleClick(evt);

    expect(emitted).toHaveBeenCalledWith(evt);
  });
});
