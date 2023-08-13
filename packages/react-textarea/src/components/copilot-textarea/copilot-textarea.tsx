// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import { BaseEditor, Descendant, createEditor, Element } from "slate";
import {
  Editable,
  ReactEditor,
  RenderElementProps,
  RenderLeafProps,
  Slate,
  withReact,
} from "slate-react";
import { HistoryEditor } from "slate-history";
import { useCallback, useEffect, useRef, useState } from "react";
import { editorToText } from "../../lib/editorToText";
import { useAutocomplete } from "../../hooks/useAutocomplete";
import { Editor, Node, Path, Range, Text } from "slate";

export interface AutocompleteConfig {
  autocomplete: (
    textBefore: string,
    textAfter: string,
    abortSignal: AbortSignal
  ) => Promise<string>;
  debounceTime: number;
}

export interface CopilotTextareaProps {
  className?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  autocompleteConfig: AutocompleteConfig;
}

export type CustomEditor = BaseEditor & ReactEditor & HistoryEditor;

export type ParagraphElement = {
  type: "paragraph";
  children: CustomText[];
};

export type SuggestionElement = {
  type: "suggestion";
  inline: boolean;
  content: string;
  children: CustomText[];
};

export type CustomElement = ParagraphElement | SuggestionElement;
export type SuggestionAwareText = { text: string };
export type CustomText = SuggestionAwareText;

declare module "slate" {
  interface CustomTypes {
    Editor: CustomEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}

export function CopilotTextarea(props: CopilotTextareaProps): JSX.Element {
  const initialValue: Descendant[] = [
    {
      type: "paragraph",
      children: [{ text: "" }],
    },
  ];

  const [editor] = useState(() => {
    const editor = withReact(createEditor());

    const { isVoid } = editor;
    editor.isVoid = (element) => {
      switch (element.type) {
        case "suggestion":
          return true;
        default:
          return isVoid(element);
      }
    };

    const { markableVoid } = editor;
    editor.markableVoid = (element) => {
      switch (element.type) {
        case "suggestion":
          return true;
        default:
          return markableVoid(element);
      }
    };

    const { isInline } = editor;
    editor.isInline = (element) => {
      switch (element.type) {
        case "suggestion":
          return element.inline;
        default:
          return isInline(element);
      }
    };

    return editor;
  });

  const renderElementMemoized = useCallback(renderElement, []);
  const onChangeForAutocomplete = useCallback(
    useAutocomplete(props.autocompleteConfig),
    [editor, props.autocompleteConfig]
  );

  const [textBeforeCursor, setTextBeforeCursor] = useState("");
  const [textAfterCursor, setTextAfterCursor] = useState("");

  return (
    // Add the editable component inside the context.
    <Slate
      editor={editor}
      initialValue={initialValue}
      onChange={(value) => {
        const { before, after } = getTextAroundCursor(editor);

        if (before !== textBeforeCursor || after !== textAfterCursor) {
          console.log("before", before, "textBeforeCursor", textBeforeCursor);
          console.log("after", after, "textAfterCursor", textAfterCursor);
          onChangeForAutocomplete(editor, before, after);
        }
        setTextBeforeCursor(before);
        setTextAfterCursor(after);
      }}
    >
      <Editable
        className={props.className}
        renderElement={renderElementMemoized}
      />
    </Slate>
  );
}

function renderElement(props: RenderElementProps) {
  switch (props.element.type) {
    case "paragraph":
      return <DefaultElement {...props} />;
    case "suggestion":
      return <SuggestionElement {...props} />;
  }
}

const DefaultElement = (props: RenderElementProps) => {
  return <div {...props.attributes}>{props.children}</div>;
};

const SuggestionElement = (props: RenderElementProps) => {
  return (
    <span
      {...props.attributes}
      style={{
        fontStyle: "italic",
        color: "gray",
      }}
      contentEditable={false}
    >
      {props.element.type === "suggestion" && props.element.content}
    </span>
  );
};

function getTextAroundCursor(editor: Editor): {
  before: string;
  after: string;
} {
  const { selection } = editor;

  if (!selection) {
    return { before: "", after: "" };
  }

  // Helper function to extract text with newlines
  const extractTextWithNewlines = (range: Range) => {
    const voids = false;
    const [start, end] = Range.edges(range);
    let text = "";
    let lastBlock: Node | null = null;

    for (const [node, path] of Editor.nodes(editor, {
      at: range,
      match: Text.isText,
      voids,
    })) {
      let t = node.text;

      // Determine the parent block of the current text node
      const [block] = Editor.above(editor, {
        at: path,
        match: (n) => Element.isElement(n) && n.type === "paragraph",
      }) || [null];

      // If we encounter a new block, prepend a newline
      if (lastBlock !== block && block) {
        // check that lastBlock is not null to avoid adding a newline at the beginning
        if (lastBlock) {
          text += "\n";
        }
        lastBlock = block;
      }

      if (Path.equals(path, end.path)) {
        t = t.slice(0, end.offset);
      }

      if (Path.equals(path, start.path)) {
        t = t.slice(start.offset);
      }

      text += t;
    }

    return text;
  };

  // Create two ranges: one before the anchor and one after
  const beforeRange: Range = {
    anchor: Editor.start(editor, []),
    focus: selection.anchor,
  };
  const afterRange: Range = {
    anchor: selection.anchor,
    focus: Editor.end(editor, []),
  };

  // Extract text for these ranges
  const before = extractTextWithNewlines(beforeRange);
  const after = extractTextWithNewlines(afterRange);

  return { before, after };
}
