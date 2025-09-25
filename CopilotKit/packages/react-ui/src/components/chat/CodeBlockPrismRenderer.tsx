import { Prism, SyntaxHighlighterProps } from "react-syntax-highlighter";

const CodeBlockPrismRenderer = ({ children, ...props }: SyntaxHighlighterProps) => {
  return <Prism {...props}>{children}</Prism>;
};

export default CodeBlockPrismRenderer;
