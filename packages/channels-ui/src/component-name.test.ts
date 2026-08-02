import { describe, it, expect } from "vitest";
import {
  defineChannelComponent,
  resolveComponentName,
} from "./component-name.js";
import {
  Actions,
  Button,
  Input,
  Message,
  Section,
  Select,
  Table,
} from "./components.js";

describe("resolveComponentName", () => {
  it("falls back to fn.name when nothing is pinned", () => {
    function ApprovalCard() {
      return null;
    }
    expect(resolveComponentName(ApprovalCard)).toBe("ApprovalCard");
  });

  it("prefers the pinned displayName over fn.name", () => {
    // What a mangling minifier leaves behind: the declaration name is gone,
    // the pinned identity survives.
    const mangled = defineChannelComponent("ApprovalCard", function a() {
      return null;
    });
    expect(mangled.name).toBe("a");
    expect(resolveComponentName(mangled)).toBe("ApprovalCard");
  });

  it("returns undefined for a component with no usable identity", () => {
    // A closure returned from a factory gets no inferred name.
    const anonymous = (
      () => () =>
        null
    )();
    expect(anonymous.name).toBe("");
    expect(resolveComponentName(anonymous)).toBeUndefined();
  });

  it("ignores a non-string or empty displayName", () => {
    function Named() {
      return null;
    }
    Object.assign(Named, { displayName: "" });
    expect(resolveComponentName(Named)).toBe("Named");
    Object.assign(Named, { displayName: 42 });
    expect(resolveComponentName(Named)).toBe("Named");
  });

  it("returns undefined for non-functions", () => {
    expect(resolveComponentName(undefined)).toBeUndefined();
    expect(
      resolveComponentName({ displayName: "NotAComponent" }),
    ).toBeUndefined();
  });
});

describe("defineChannelComponent", () => {
  it("pins the name and returns the same function", () => {
    const fn = () => null;
    const pinned = defineChannelComponent("Card", fn);
    expect(pinned).toBe(fn);
    expect(pinned.displayName).toBe("Card");
  });

  it("rejects an empty name — the identity is the whole point", () => {
    expect(() => defineChannelComponent("", () => null)).toThrow(
      /non-empty string/,
    );
  });
});

describe("library components", () => {
  // Two distinct cases, one shared threat — a bundler rewriting `fn.name`:
  //   * Message/Section/Actions come from the `intrinsic` factory, which
  //     returns an anonymous closure (`fn.name === ""`). Without the pin they'd
  //     have no identity at all, so every `<Message>`-rooted post would register
  //     as "anonymous" and their action ids would collide.
  //   * Button/Select/Input/Table are plain function declarations, so `fn.name`
  //     already reads correctly *in source* — but a minifier mangling this
  //     library would silently rewrite it, changing every action id minted from
  //     a tree rooted at one of them.
  // Both are pinned via `displayName`, which no bundler can touch. Asserting
  // `resolveComponentName` on the pristine component is tautological for the
  // declarations (it just re-reads `fn.name`); to verify the pin actually does
  // its job we mangle `fn.name` first and confirm the identity still resolves.
  it.each([
    [Message, "Message"],
    [Section, "Section"],
    [Actions, "Actions"],
    [Button, "Button"],
    [Select, "Select"],
    [Input, "Input"],
    [Table, "Table"],
  ])(
    "keeps a stable identity when a bundler mangles fn.name (%#)",
    (component, expected) => {
      // `Function.prototype.name` is configurable but not writable — redefine it
      // to stand in for what a minifier leaves behind, then restore it.
      const originalName = Object.getOwnPropertyDescriptor(component, "name");
      try {
        Object.defineProperty(component, "name", {
          value: "a",
          configurable: true,
        });
        expect(component.name).toBe("a");
        expect(resolveComponentName(component)).toBe(expected);
      } finally {
        if (originalName) {
          Object.defineProperty(component, "name", originalName);
        }
      }
    },
  );

  it("gives each intrinsic a distinct identity", () => {
    const names = [Message, Section, Actions, Button, Select, Input, Table].map(
      (c) => resolveComponentName(c),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
