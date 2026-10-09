import { createEditor, Descendant } from "slate";
import { editorToText } from "./editor-to-text";
import { getFullEditorTextWithNewlines } from "./get-text-around-cursor";

const editorWith = (children: any[]) => {
  const editor = createEditor();
  editor.children = children as Descendant[];
  return editor;
};

describe("editorToText", () => {
  it("does not insert newlines between text nodes inside one block", () => {
    const editor = editorWith([
      {
        type: "paragraph",
        children: [
          { text: "Hello " },
          {
            type: "suggestion",
            inline: true,
            content: "SUGGESTED",
            children: [{ text: "" }],
          },
          { text: "world" },
        ],
      },
    ]);

    expect(editorToText(editor)).toBe("Hello world");
  });

  it("agrees with getFullEditorTextWithNewlines on a split block", () => {
    const editor = editorWith([
      {
        type: "paragraph",
        children: [{ text: "Hello " }, { text: "world" }],
      },
    ]);

    expect(editorToText(editor)).toBe(getFullEditorTextWithNewlines(editor));
  });

  it("still separates blocks with a newline", () => {
    const editor = editorWith([
      { type: "paragraph", children: [{ text: "one" }] },
      { type: "paragraph", children: [{ text: "two" }] },
    ]);

    expect(editorToText(editor)).toBe("one\ntwo");
  });

  it("reads a single unsplit block unchanged", () => {
    const editor = editorWith([
      { type: "paragraph", children: [{ text: "Hello world" }] },
    ]);

    expect(editorToText(editor)).toBe("Hello world");
  });
});
