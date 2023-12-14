import { RenderElementProps } from "slate-react";

export type RenderElementFunction = (props: RenderElementProps) => JSX.Element;

export function makeRenderElementFunction(
  suggestionsStyle: React.CSSProperties,
): RenderElementFunction {
  return (props: RenderElementProps) => {
    switch (props.element.type) {
      case "paragraph":
        return <DefaultElement {...props} />;
      case "suggestion":
        return <SuggestionElement {...props} suggestionsStyle={suggestionsStyle} />;
      case "bold": // Handle bold formatting
        return <BoldElement {...props} />;
      case "italic": // Handle italic formatting
        return <ItalicElement {...props} />;
    }
  };
}

const BoldElement = (props: RenderElementProps) => {
  return <strong {...props.attributes}>{props.children}</strong>;
};

const ItalicElement = (props: RenderElementProps) => {
  return <em {...props.attributes}>{props.children}</em>;
};

const DefaultElement = (props: RenderElementProps) => {
  return <div {...props.attributes}>{props.children}</div>;
};
const SuggestionElement = (
  props: RenderElementProps & {
    suggestionsStyle: React.CSSProperties;
  },
) => {
  return (
    <span
      {...props.attributes}
      style={{
        ...props.suggestionsStyle,
      }}
      contentEditable={false}
    >
      {props.children /* https://github.com/ianstormtaylor/slate/issues/3930 */}
      {props.element.type === "suggestion" && props.element.content}
    </span>
  );
};
