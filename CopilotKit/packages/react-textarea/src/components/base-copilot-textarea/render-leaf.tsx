import { RenderLeafProps } from "slate-react";

export type RenderLeafFunction = (props: RenderLeafProps) => JSX.Element;

export function makeRenderLeafFunction(): RenderLeafFunction {
  return (props: RenderLeafProps) => {
    let { children } = props;

    if (props.leaf.bold) {
      children = <strong>{children}</strong>;
    }

    if (props.leaf.italic) {
      children = <em>{children}</em>;
    }

    return <span {...props.attributes}>{children}</span>;
  };
}
