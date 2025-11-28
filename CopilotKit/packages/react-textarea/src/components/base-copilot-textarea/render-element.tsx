import { RenderElementProps } from "slate-react";

export type RenderElementFunction = (props: RenderElementProps) => JSX.Element;

export function makeRenderElementFunction(
  suggestionsStyle: React.CSSProperties,
): RenderElementFunction {
  return (props: RenderElementProps) => {
    switch (props.element.type) {
      case "paragraph":
        return <ParagraphElement {...props} />;
      case "suggestion":
        return <SuggestionElement {...props} suggestionsStyle={suggestionsStyle} />;
      default:
        return <ParagraphElement {...props} />;
    }
  };
}

const ParagraphElement = (props: RenderElementProps) => {
  return <p {...props.attributes}>{props.children}</p>;
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
      data-testid="suggestion"
      contentEditable={false}
    >
      {props.children /* https://github.com/ianstormtaylor/slate/issues/3930 */}
      {props.element.type === "suggestion" && props.element.content}
    </span>
  );
};
