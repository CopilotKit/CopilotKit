import { FC, memo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useCopyToClipboard } from "../../hooks/use-copy-to-clipboard";
import { CheckIcon, CopyIcon, DownloadIcon } from "./Icons";

interface CodeActionButtonProps {
  onClick: () => void;
  children: React.ReactNode;
}

interface Props {
  language: string;
  value: string;
}

interface languageMap {
  [key: string]: string | undefined;
}

export const programmingLanguages: languageMap = {
  javascript: ".js",
  python: ".py",
  java: ".java",
  c: ".c",
  cpp: ".cpp",
  "c++": ".cpp",
  "c#": ".cs",
  ruby: ".rb",
  php: ".php",
  swift: ".swift",
  "objective-c": ".m",
  kotlin: ".kt",
  typescript: ".ts",
  go: ".go",
  perl: ".pl",
  rust: ".rs",
  scala: ".scala",
  haskell: ".hs",
  lua: ".lua",
  shell: ".sh",
  sql: ".sql",
  html: ".html",
  css: ".css",
  // add more file extensions here, make sure the key is same as language prop in CodeBlock.tsx component
};

export const generateRandomString = (length: number, lowercase = false) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXY3456789"; // excluding similar looking characters like Z, 2, I, 1, O, 0
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return lowercase ? result.toLowerCase() : result;
};

const CodeBlock: FC<Props> = memo(({ language, value }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 2000 });

  const downloadAsFile = () => {
    if (typeof window === "undefined") {
      return;
    }
    const fileExtension = programmingLanguages[language] || ".file";
    const suggestedFileName = `file-${generateRandomString(3, true)}${fileExtension}`;
    const fileName = window.prompt("Enter file name" || "", suggestedFileName);

    if (!fileName) {
      // User pressed cancel on prompt.
      return;
    }

    const blob = new Blob([value], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = fileName;
    link.href = url;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const onCopy = () => {
    if (isCopied) return;
    copyToClipboard(value);
  };

  return (
    <div className="copilotKitCodeBlock">
      <div className="copilotKitCodeBlockToolbar">
        <span className="copilotKitCodeBlockToolbarLanguage">{language}</span>
        <div className="copilotKitCodeBlockToolbarButtons">
          <button className="copilotKitCodeBlockToolbarButton" onClick={downloadAsFile}>
            <DownloadIcon />
            <span className="sr-only">Download</span>
          </button>
          <button className="copilotKitCodeBlockToolbarButton" onClick={onCopy}>
            {isCopied ? <CheckIcon /> : <CopyIcon />}
            <span className="sr-only">Copy code</span>
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={language}
        style={highlightStyle}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderBottomLeftRadius: "0.375rem",
          borderBottomRightRadius: "0.375rem",
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
});
CodeBlock.displayName = "CodeBlock";

export { CodeBlock };

// import { vscDarkPlus as highlightStyle } from "react-syntax-highlighter/dist/esm/styles/prism";
// As a workaround, we inline the vscDarkPlus from react-syntax-highlighter.
// Importing it as recommended in the documentation leads to build errors in the non app router
// (Next.js classic) setup.
const highlightStyle: any = {
  'pre[class*="language-"]': {
    color: "#d4d4d4",
    fontSize: "13px",
    textShadow: "none",
    fontFamily: 'Menlo, Monaco, Consolas, "Andale Mono", "Ubuntu Mono", "Courier New", monospace',
    direction: "ltr",
    textAlign: "left",
    whiteSpace: "pre",
    wordSpacing: "normal",
    wordBreak: "normal",
    lineHeight: "1.5",
    MozTabSize: "4",
    OTabSize: "4",
    tabSize: "4",
    WebkitHyphens: "none",
    MozHyphens: "none",
    msHyphens: "none",
    hyphens: "none",
    padding: "1em",
    margin: ".5em 0",
    overflow: "auto",
    background: "#1e1e1e",
  },
  'code[class*="language-"]': {
    color: "#d4d4d4",
    fontSize: "13px",
    textShadow: "none",
    fontFamily: 'Menlo, Monaco, Consolas, "Andale Mono", "Ubuntu Mono", "Courier New", monospace',
    direction: "ltr",
    textAlign: "left",
    whiteSpace: "pre",
    wordSpacing: "normal",
    wordBreak: "normal",
    lineHeight: "1.5",
    MozTabSize: "4",
    OTabSize: "4",
    tabSize: "4",
    WebkitHyphens: "none",
    MozHyphens: "none",
    msHyphens: "none",
    hyphens: "none",
  },
  'pre[class*="language-"]::selection': {
    textShadow: "none",
    background: "#264F78",
  },
  'code[class*="language-"]::selection': {
    textShadow: "none",
    background: "#264F78",
  },
  'pre[class*="language-"] *::selection': {
    textShadow: "none",
    background: "#264F78",
  },
  'code[class*="language-"] *::selection': {
    textShadow: "none",
    background: "#264F78",
  },
  ':not(pre) > code[class*="language-"]': {
    padding: ".1em .3em",
    borderRadius: ".3em",
    color: "#db4c69",
    background: "#1e1e1e",
  },
  ".namespace": {
    Opacity: ".7",
  },
  "doctype.doctype-tag": {
    color: "#569CD6",
  },
  "doctype.name": {
    color: "#9cdcfe",
  },
  comment: {
    color: "#6a9955",
  },
  prolog: {
    color: "#6a9955",
  },
  punctuation: {
    color: "#d4d4d4",
  },
  ".language-html .language-css .token.punctuation": {
    color: "#d4d4d4",
  },
  ".language-html .language-javascript .token.punctuation": {
    color: "#d4d4d4",
  },
  property: {
    color: "#9cdcfe",
  },
  tag: {
    color: "#569cd6",
  },
  boolean: {
    color: "#569cd6",
  },
  number: {
    color: "#b5cea8",
  },
  constant: {
    color: "#9cdcfe",
  },
  symbol: {
    color: "#b5cea8",
  },
  inserted: {
    color: "#b5cea8",
  },
  unit: {
    color: "#b5cea8",
  },
  selector: {
    color: "#d7ba7d",
  },
  "attr-name": {
    color: "#9cdcfe",
  },
  string: {
    color: "#ce9178",
  },
  char: {
    color: "#ce9178",
  },
  builtin: {
    color: "#ce9178",
  },
  deleted: {
    color: "#ce9178",
  },
  ".language-css .token.string.url": {
    textDecoration: "underline",
  },
  operator: {
    color: "#d4d4d4",
  },
  entity: {
    color: "#569cd6",
  },
  "operator.arrow": {
    color: "#569CD6",
  },
  atrule: {
    color: "#ce9178",
  },
  "atrule.rule": {
    color: "#c586c0",
  },
  "atrule.url": {
    color: "#9cdcfe",
  },
  "atrule.url.function": {
    color: "#dcdcaa",
  },
  "atrule.url.punctuation": {
    color: "#d4d4d4",
  },
  keyword: {
    color: "#569CD6",
  },
  "keyword.module": {
    color: "#c586c0",
  },
  "keyword.control-flow": {
    color: "#c586c0",
  },
  function: {
    color: "#dcdcaa",
  },
  "function.maybe-class-name": {
    color: "#dcdcaa",
  },
  regex: {
    color: "#d16969",
  },
  important: {
    color: "#569cd6",
  },
  italic: {
    fontStyle: "italic",
  },
  "class-name": {
    color: "#4ec9b0",
  },
  "maybe-class-name": {
    color: "#4ec9b0",
  },
  console: {
    color: "#9cdcfe",
  },
  parameter: {
    color: "#9cdcfe",
  },
  interpolation: {
    color: "#9cdcfe",
  },
  "punctuation.interpolation-punctuation": {
    color: "#569cd6",
  },
  variable: {
    color: "#9cdcfe",
  },
  "imports.maybe-class-name": {
    color: "#9cdcfe",
  },
  "exports.maybe-class-name": {
    color: "#9cdcfe",
  },
  escape: {
    color: "#d7ba7d",
  },
  "tag.punctuation": {
    color: "#808080",
  },
  cdata: {
    color: "#808080",
  },
  "attr-value": {
    color: "#ce9178",
  },
  "attr-value.punctuation": {
    color: "#ce9178",
  },
  "attr-value.punctuation.attr-equals": {
    color: "#d4d4d4",
  },
  namespace: {
    color: "#4ec9b0",
  },
  'pre[class*="language-javascript"]': {
    color: "#9cdcfe",
  },
  'code[class*="language-javascript"]': {
    color: "#9cdcfe",
  },
  'pre[class*="language-jsx"]': {
    color: "#9cdcfe",
  },
  'code[class*="language-jsx"]': {
    color: "#9cdcfe",
  },
  'pre[class*="language-typescript"]': {
    color: "#9cdcfe",
  },
  'code[class*="language-typescript"]': {
    color: "#9cdcfe",
  },
  'pre[class*="language-tsx"]': {
    color: "#9cdcfe",
  },
  'code[class*="language-tsx"]': {
    color: "#9cdcfe",
  },
  'pre[class*="language-css"]': {
    color: "#ce9178",
  },
  'code[class*="language-css"]': {
    color: "#ce9178",
  },
  'pre[class*="language-html"]': {
    color: "#d4d4d4",
  },
  'code[class*="language-html"]': {
    color: "#d4d4d4",
  },
  ".language-regex .token.anchor": {
    color: "#dcdcaa",
  },
  ".language-html .token.punctuation": {
    color: "#808080",
  },
  'pre[class*="language-"] > code[class*="language-"]': {
    position: "relative",
    zIndex: "1",
  },
  ".line-highlight.line-highlight": {
    background: "#f7ebc6",
    boxShadow: "inset 5px 0 0 #f7d87c",
    zIndex: "0",
  },
};
