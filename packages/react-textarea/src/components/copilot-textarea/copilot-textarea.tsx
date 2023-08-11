// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import { BaseEditor, Descendant, createEditor } from "slate";
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

export interface AutocompleteConfig {
  autocomplete: (input: string, signal?: AbortSignal) => Promise<string>;
  debounceTime?: number;
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

    const { onChange } = editor;
    editor.onChange = () => {
      // props.onChange?.(editorToText(editor));
      onChange();
    };

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
          return true;
        default:
          return isInline(element);
      }
    };

    return editor;
  });

  const renderElementMemoized = useCallback(renderElement, []);
  const handleAutocompleteKeyDown = useCallback(
    useAutocomplete(editor, props.autocompleteConfig),
    [editor, props.autocompleteConfig]
  );

  return (
    // Add the editable component inside the context.
    <Slate editor={editor} initialValue={initialValue}>
      <Editable
        className={props.className}
        renderElement={renderElementMemoized}
        onKeyDown={handleAutocompleteKeyDown}
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
  return <span {...props.attributes}>{props.children}</span>;
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
      {props.element.children.map((child, index) => child.text)}
      {props.children}
    </span>
  );
};
