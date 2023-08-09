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

export type CustomElement = ParagraphElement;
export type SuggestionAwareText = { text: string; isSuggestion: boolean };
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
      children: [{ text: props.value || "", isSuggestion: false }],
    },
  ];

  const [editor] = useState(() => {
    const editor = withReact(createEditor());
    editor.onChange = () => {
      props.onChange?.(editorToText(editor));
    };
    return editor;
  });

  const renderElementMemoized = useCallback(renderElement, []);
  const renderLeafMemoized = useCallback(renderLeaf, []);
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
        renderLeaf={renderLeafMemoized}
        onKeyDown={handleAutocompleteKeyDown}
      />
    </Slate>
  );
}

function renderLeaf(props: RenderLeafProps) {
  return (
    <span
      {...props.attributes}
      style={{
        fontStyle: props.leaf.isSuggestion ? "italic" : "normal",
        color: props.leaf.isSuggestion ? "gray" : "black",
      }}
    >
      {props.children}
    </span>
  );
}

function renderElement(props: RenderElementProps) {
  switch (props.element.type) {
    case "paragraph":
      return <DefaultElement {...props} />;
  }
}

const DefaultElement = (props: RenderElementProps) => {
  return <p {...props.attributes}>{props.children}</p>;
};
