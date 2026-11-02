import { createEditor, Editor, Transforms } from "slate";
import { replaceEditorText } from "./replace-text";
import { getFullEditorTextWithNewlines } from "../get-text-around-cursor";

const seedEditor = () => {
  const editor = createEditor();
  editor.children = [
    { type: "paragraph", children: [{ text: "seed" }] } as any,
  ];
  Transforms.select(editor, { path: [0, 0], offset: 4 });
  return editor;
};

describe("replaceEditorText", () => {
  it("fills the cleared block instead of adding a second one", () => {
    const editor = seedEditor();

    replaceEditorText(editor, "hello");

    expect(editor.children).toHaveLength(1);
    expect(getFullEditorTextWithNewlines(editor)).toBe("hello");
  });

  it("round-trips the exact value it was given", () => {
    const editor = seedEditor();

    replaceEditorText(editor, "hello");
    expect(getFullEditorTextWithNewlines(editor)).toBe("hello");

    replaceEditorText(editor, "goodbye");
    expect(editor.children).toHaveLength(1);
    expect(getFullEditorTextWithNewlines(editor)).toBe("goodbye");
  });

  it("replaces a multi-block document with a single block", () => {
    const editor = createEditor();
    editor.children = [
      { type: "paragraph", children: [{ text: "one" }] } as any,
      { type: "paragraph", children: [{ text: "two" }] } as any,
    ];
    Transforms.select(editor, Editor.end(editor, []));

    replaceEditorText(editor, "fresh");

    expect(editor.children).toHaveLength(1);
    expect(getFullEditorTextWithNewlines(editor)).toBe("fresh");
  });

  it("still leaves the document empty when given an empty string", () => {
    const editor = seedEditor();

    replaceEditorText(editor, "");

    expect(getFullEditorTextWithNewlines(editor)).toBe("");
  });
});
