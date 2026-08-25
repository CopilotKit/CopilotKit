import { describe, expect, it } from "vitest";
import {
  pickSaveSnippetSide,
  saveSnippetBesideStyle,
} from "../save-snippet-beside";

describe("pickSaveSnippetSide", () => {
  it("puts the icon on the right when there is room on the right", () => {
    expect(pickSaveSnippetSide(40, 8)).toBe("right");
  });

  it("puts the icon on the left when the right is too tight", () => {
    expect(pickSaveSnippetSide(8, 40)).toBe("left");
  });

  it("stays on the right when both sides are too tight", () => {
    expect(pickSaveSnippetSide(8, 8)).toBe("right");
  });
});

describe("saveSnippetBesideStyle", () => {
  it("hangs the icon just outside the right edge", () => {
    expect(saveSnippetBesideStyle("right")).toEqual({
      left: "100%",
      right: "auto",
      marginLeft: 4,
      marginRight: 0,
    });
  });

  it("hangs the icon just outside the left edge", () => {
    expect(saveSnippetBesideStyle("left")).toEqual({
      left: "auto",
      right: "100%",
      marginLeft: 0,
      marginRight: 4,
    });
  });
});
