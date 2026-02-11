export function completePartialMarkdown(input: string): string {
  let s = input;

  // Handle code fences first - use FIRST unmatched fence for proper nesting
  const fenceMatches = Array.from(s.matchAll(/^(\s*)(`{3,}|~{3,})/gm));
  if (fenceMatches.length % 2 === 1) {
    const [, indent, fence] = fenceMatches[0]!;
    s += `\n${indent}${fence}`;
  }

  // Identify incomplete links at the end and close them
  const incompleteLinkMatch = s.match(/\[([^\]]*)\]\(([^)]*)$/);
  if (incompleteLinkMatch) {
    s += ")";
  }

  // State-based parsing
  interface OpenElement {
    type: string;
    marker: string;
    position: number;
  }

  const openElements: OpenElement[] = [];
  const chars = Array.from(s);

  // First pass: identify code block boundaries and inline code to avoid processing their content
  const codeBlockRanges: Array<{ start: number; end: number }> = [];
  const inlineCodeRanges: Array<{ start: number; end: number }> = [];

  // Find code block ranges
  let tempCodeFenceCount = 0;
  let currentCodeBlockStart = -1;

  for (let i = 0; i < chars.length; i++) {
    if (i === 0 || chars[i - 1] === "\n") {
      const lineMatch = s.substring(i).match(/^(\s*)(`{3,}|~{3,})/);
      if (lineMatch) {
        tempCodeFenceCount++;
        if (tempCodeFenceCount % 2 === 1) {
          currentCodeBlockStart = i;
        } else if (currentCodeBlockStart !== -1) {
          codeBlockRanges.push({
            start: currentCodeBlockStart,
            end: i + lineMatch[0].length,
          });
          currentCodeBlockStart = -1;
        }
        i += lineMatch[0].length - 1;
      }
    }
  }

  // Find inline code ranges
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "`") {
      // Check if escaped
      let backslashCount = 0;
      for (let j = i - 1; j >= 0 && chars[j] === "\\"; j--) {
        backslashCount++;
      }
      if (backslashCount % 2 === 0) {
        // Not escaped - find the closing backtick
        for (let j = i + 1; j < chars.length; j++) {
          if (chars[j] === "`") {
            let closingBackslashCount = 0;
            for (let k = j - 1; k >= 0 && chars[k] === "\\"; k--) {
              closingBackslashCount++;
            }
            if (closingBackslashCount % 2 === 0) {
              inlineCodeRanges.push({ start: i, end: j + 1 });
              i = j;
              break;
            }
          }
        }
      }
    }
  }

  // Helper function to check if position is in code
  const isInCode = (pos: number): boolean => {
    return (
      codeBlockRanges.some((range) => pos >= range.start && pos < range.end) ||
      inlineCodeRanges.some((range) => pos >= range.start && pos < range.end)
    );
  };

  // Second pass: process markdown elements, skipping code regions
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const nextChar = chars[i + 1];
    const prevChar = chars[i - 1];

    if (isInCode(i)) {
      continue;
    }

    // Handle brackets (but not if they're part of already-complete links)
    if (char === "[") {
      // Check if this is part of a complete link [text](url)
      let isCompleteLink = false;
      let bracketDepth = 1;
      let j = i + 1;

      // Find the matching ]
      while (j < chars.length && bracketDepth > 0) {
        if (chars[j] === "[" && !isInCode(j)) bracketDepth++;
        if (chars[j] === "]" && !isInCode(j)) bracketDepth--;
        j++;
      }

      // Check if followed by (
      if (bracketDepth === 0 && chars[j] === "(") {
        // Find the closing )
        let parenDepth = 1;
        j++;
        while (j < chars.length && parenDepth > 0) {
          if (chars[j] === "(" && !isInCode(j)) parenDepth++;
          if (chars[j] === ")" && !isInCode(j)) parenDepth--;
          j++;
        }
        if (parenDepth === 0) {
          isCompleteLink = true;
          i = j - 1;
          continue;
        }
      }

      // This is a standalone bracket, treat as markdown
      if (!isCompleteLink) {
        const existingIndex = openElements.findIndex(
          (el) => el.type === "bracket"
        );
        if (existingIndex !== -1) {
          openElements.splice(existingIndex, 1);
        } else {
          openElements.push({ type: "bracket", marker: "[", position: i });
        }
      }
    }

    // Handle double emphasis first (**, __, ~~) - these take precedence
    else if (char === "*" && nextChar === "*") {
      const existingIndex = openElements.findIndex(
        (el) => el.type === "bold_star"
      );
      if (existingIndex !== -1) {
        openElements.splice(existingIndex, 1);
      } else {
        openElements.push({ type: "bold_star", marker: "**", position: i });
      }
      i++; // Skip next character
    } else if (char === "_" && nextChar === "_") {
      const existingIndex = openElements.findIndex(
        (el) => el.type === "bold_underscore"
      );
      if (existingIndex !== -1) {
        openElements.splice(existingIndex, 1);
      } else {
        openElements.push({
          type: "bold_underscore",
          marker: "__",
          position: i,
        });
      }
      i++; // Skip next character
    } else if (char === "~" && nextChar === "~") {
      const existingIndex = openElements.findIndex(
        (el) => el.type === "strike"
      );
      if (existingIndex !== -1) {
        openElements.splice(existingIndex, 1);
      } else {
        openElements.push({ type: "strike", marker: "~~", position: i });
      }
      i++; // Skip next character
    }

    // Handle single emphasis (*, _) - only if not part of double
    else if (char === "*" && prevChar !== "*" && nextChar !== "*") {
      const existingIndex = openElements.findIndex(
        (el) => el.type === "italic_star"
      );
      if (existingIndex !== -1) {
        openElements.splice(existingIndex, 1);
      } else {
        openElements.push({ type: "italic_star", marker: "*", position: i });
      }
    } else if (char === "_" && prevChar !== "_" && nextChar !== "_") {
      const existingIndex = openElements.findIndex(
        (el) => el.type === "italic_underscore"
      );
      if (existingIndex !== -1) {
        openElements.splice(existingIndex, 1);
      } else {
        openElements.push({
          type: "italic_underscore",
          marker: "_",
          position: i,
        });
      }
    }
  }

  // Handle remaining unmatched backticks (outside of inline code ranges)
  let backtickCount = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "`" && !isInCode(i)) {
      backtickCount++;
    }
  }
  if (backtickCount % 2 === 1) {
    s += "`";
  }

  // Close remaining open elements in reverse order (LIFO stack semantics)
  openElements.sort((a, b) => b.position - a.position);

  const closers = openElements.map((el) => {
    switch (el.type) {
      case "bracket":
        return "]";
      case "bold_star":
        return "**";
      case "bold_underscore":
        return "__";
      case "strike":
        return "~~";
      case "italic_star":
        return "*";
      case "italic_underscore":
        return "_";
      default:
        return "";
    }
  });

  let result = s + closers.join("");

  // Handle parentheses ONLY if not inside code
  const finalFenceMatches = Array.from(
    result.matchAll(/^(\s*)(`{3,}|~{3,})/gm)
  );
  const hasUnclosedBacktick = (result.match(/`/g) || []).length % 2 === 1;
  const hasUnclosedCodeFence = finalFenceMatches.length % 2 === 1;

  let shouldCloseParens = !hasUnclosedBacktick && !hasUnclosedCodeFence;

  if (shouldCloseParens) {
    const lastOpenParen = result.lastIndexOf("(");
    if (lastOpenParen !== -1) {
      // Check if this paren is inside a backtick pair
      const beforeParen = result.substring(0, lastOpenParen);
      const backticksBeforeParen = (beforeParen.match(/`/g) || []).length;
      if (backticksBeforeParen % 2 === 1) {
        shouldCloseParens = false;
      }
    }
  }

  if (shouldCloseParens) {
    const openParens = (result.match(/\(/g) || []).length;
    const closeParens = (result.match(/\)/g) || []).length;
    if (openParens > closeParens) {
      result += ")".repeat(openParens - closeParens);
    }
  }

  return result;
}