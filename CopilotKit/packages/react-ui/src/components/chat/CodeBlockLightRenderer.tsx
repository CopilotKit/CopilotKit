import { Light, SyntaxHighlighterProps } from "react-syntax-highlighter";

const CodeBlockLightRenderer = ({ children, ...props }: SyntaxHighlighterProps) => {
  return <Light {...props}>{children}</Light>;
};

export default CodeBlockLightRenderer;
