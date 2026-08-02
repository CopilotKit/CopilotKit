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
  // Without pinned names these all resolve to "" (the `intrinsic` factory
  // returns an anonymous closure), so every `<Message>`-rooted post would
  // register as "anonymous" and their action ids would collide.
  it.each([
    [Message, "Message"],
    [Section, "Section"],
    [Actions, "Actions"],
    [Button, "Button"],
    [Select, "Select"],
    [Input, "Input"],
    [Table, "Table"],
  ])("pins a stable identity (%#)", (component, expected) => {
    expect(resolveComponentName(component)).toBe(expected);
  });

  it("gives each intrinsic a distinct identity", () => {
    const names = [Message, Section, Actions, Button, Select, Input, Table].map(
      (c) => resolveComponentName(c),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});
