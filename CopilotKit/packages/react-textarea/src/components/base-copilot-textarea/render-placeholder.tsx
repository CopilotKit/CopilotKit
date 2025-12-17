import { RenderPlaceholderProps } from "slate-react";
import React from "react";

export type RenderPlaceholderFunction = (props: RenderPlaceholderProps) => React.JSX.Element;

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
