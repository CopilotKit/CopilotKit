import { RenderElementProps } from "slate-react";

export function renderElement(props: RenderElementProps) {
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
