import * as ts from "typescript";

export class Comments {
  static getCleanedCommentsForNode(node: ts.Node, sourceFile: ts.SourceFile): string {
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());

    if (!commentRanges) return "";

    return commentRanges
      .map((comment) => {
        let commentText = fullText.substring(comment.pos, comment.end);
        commentText = Comments.removeCommentSyntax(commentText);

        // for now, remove @default annotations
        commentText = commentText
          .split("\n")
          .filter((line) => !line.includes("@default"))
          .join("\n");

        return commentText;
      })
      .join("\n")
      .trim();
  }

  static removeCommentSyntax(commentText: string): string {
    return commentText
      .replace(/\/\*\*|\*\/|\*|\/\* ?/gm, "")
      .replace(/^  /gm, "")
      .trim();
  }

  static getFirstCommentBlock(sourceFile: ts.SourceFile): string | null {
    for (const statement of sourceFile.statements) {
      const comments = Comments.getCleanedCommentsForNode(statement, sourceFile);
      if (comments) return comments;
    }

    return null;
  }

  static getTsDocCommentsForFunction(node: ts.Node, sourceFile: ts.SourceFile) {
    const params: Record<string, string> = {};
    const trivia = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) || [];

    let comment = "";

    for (const range of trivia) {
      const commentText = Comments.removeCommentSyntax(
        sourceFile.text.substring(range.pos, range.end),
      );

      const lines = commentText.split("\n").map((line) => line.trim());

      if (lines.length && !lines[0].startsWith("@param")) {
        comment = lines[0];
      }

      lines.forEach((line) => {
        if (line.startsWith("@param")) {
          const parts = line.split(/\s+/);
          if (parts.length >= 3) {
            const paramName = parts[1];
            const description = parts.slice(2).join(" ");
            params[paramName] = description.trim();
          }
        }
      });
    }

    return { comment, params };
  }
}
