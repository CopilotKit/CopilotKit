import { RenderPlaceholderProps } from "slate-react";

export type RenderPlaceholderFunction = (props: RenderPlaceholderProps) => JSX.Element;

export function makeRenderPlaceholderFunction(
  placeholderStyle?: React.CSSProperties,
): RenderPlaceholderFunction {
  return (props: RenderPlaceholderProps) => {
    const { style, ...restAttributes } = props.attributes;

    return (
      <div
        {...restAttributes}
        style={{
          ...style,
          ...placeholderStyle,
        }}
      >
        {props.children}
      </div>
    );
  };
}
