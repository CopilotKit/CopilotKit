// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import {
  BaseEditor,
  Descendant,
  Editor,
  Transforms,
  createEditor,
} from "slate";
import {
  Editable,
  ReactEditor,
  RenderElementProps,
  RenderLeafProps,
  Slate,
  withReact,
} from "slate-react";
import { HistoryEditor } from "slate-history";
import { useCallback, useState } from "react";
import { Element } from "slate";

export type CustomEditor = BaseEditor & ReactEditor & HistoryEditor;

export type ParagraphElement = {
  type: "paragraph";
  children: CustomText[];
};

export type CopilotSuggestionElement = {
  type: "copilot-suggestion";
  children: CustomText[];
};

export type CodeElement = {
  type: "code";
  children: CustomText[];
};

export type CustomElement =
  | ParagraphElement
  | CopilotSuggestionElement
  | CodeElement;
export type SuggestionAwareText = { text: string; isSuggestion: boolean };
export type CustomText = SuggestionAwareText;

declare module "slate" {
  interface CustomTypes {
    Editor: CustomEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}

export interface CopilotTextareaProps {
  className?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
}

export function CopilotTextarea(props: CopilotTextareaProps): JSX.Element {
  const initialValue: Descendant[] = [
    {
      type: "paragraph",
      children: [{ text: props.value || "", isSuggestion: false }],
    },
  ];

  const renderElement = useCallback((props: RenderElementProps) => {
    switch (props.element.type) {
      case "code":
        return <CodeElement {...props} />;
      case "copilot-suggestion":
        return <CopilotSuggestionElement {...props} />;
      case "paragraph":
        return <DefaultElement {...props} />;
    }
  }, []);
  const renderLeaf = useCallback((props: RenderLeafProps) => {
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
  }, []);

  const [editor] = useState(() => {
    const editor = withReact(createEditor());
    editor.onChange = () => {
      const suggestionAwareTextComponents: SuggestionAwareText[][] =
        editor.children.map((node) => {
          if (Element.isElement(node)) {
            return node.children.map((child) => {
              return child;
            });
          } else {
            return [node];
          }
        });

      const flattened = suggestionAwareTextComponents.reduce(
        (acc, val) => acc.concat(val),
        []
      );
      const text = flattened
        .map((textComponent) => textComponent.text)
        .join("\n");

      props.onChange?.(text);
    };
    return editor;
  });

  return (
    // Add the editable component inside the context.
    <Slate editor={editor} initialValue={initialValue}>
      <Editable
        className={props.className}
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        onKeyDown={(event) => {
          if (event.key === "`" && event.ctrlKey) {
            // Prevent the "`" from being inserted by default.
            event.preventDefault();
            // Otherwise, set the currently selected blocks type to "code".
            Transforms.setNodes(
              editor,
              { type: "code" },
              {
                match: (n) => Element.isElement(n) && Editor.isBlock(editor, n),
              }
            );
          }
        }}
      />
    </Slate>
  );
}

const DefaultElement = (props: RenderElementProps) => {
  return <p {...props.attributes}>{props.children}</p>;
};

const CodeElement = (props: RenderElementProps) => {
  return (
    <pre {...props.attributes}>
      <code>{props.children}</code>
    </pre>
  );
};

const CopilotSuggestionElement = (props: RenderElementProps) => {
  return (
    <p className="text-gray-300" {...props.attributes}>
      {props.children}
    </p>
  );
};
