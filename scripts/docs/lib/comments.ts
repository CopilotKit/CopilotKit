import * as ts from "typescript";

export class Comments {
  // The v1 deprecation notice (#6582) is a banner aimed at IDEs and coding
  // agents, not at readers of the published reference pages. It lives in the
  // leading trivia of the first statement of every public v1 source file, so
  // it reaches the generator on the same path as real JSDoc and has to be
  // dropped explicitly wherever we enumerate comment ranges.
  static readonly V1_DEPRECATION_NOTICE_OPEN =
    "V1 SDK DEPRECATED. USE V2 INSTEAD";

  static isV1DeprecationNotice(commentText: string): boolean {
    return commentText
      .trimStart()
      .startsWith(Comments.V1_DEPRECATION_NOTICE_OPEN);
  }

  static getCleanedCommentsForNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
  ): string {
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(
      fullText,
      node.getFullStart(),
    );

    if (!commentRanges) return "";

    return commentRanges
      .map((comment) => {
        let commentText = fullText.substring(comment.pos, comment.end);
        commentText = Comments.removeCommentSyntax(commentText);

        if (Comments.isV1DeprecationNotice(commentText)) return "";

        // for now, remove @default annotations
        commentText = commentText
          .split("\n")
          .filter((line) => !line.includes("@default"))
          .join("\n");

        return commentText;
      })
      .filter((commentText) => commentText !== "")
      .join("\n")
      .trim();
  }

  static getDefaultValueForNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
  ): string | undefined {
    const fullText = sourceFile.getFullText();
    const commentRanges = ts.getLeadingCommentRanges(
      fullText,
      node.getFullStart(),
    );

    if (!commentRanges) return "";
    let defaultValue: string | undefined = undefined;

    for (const comment of commentRanges) {
      let commentText = fullText.substring(comment.pos, comment.end);
      commentText = Comments.removeCommentSyntax(commentText);

      if (Comments.isV1DeprecationNotice(commentText)) continue;

      for (const line of commentText.split("\n")) {
        if (line.includes("@default")) {
          defaultValue = line.split("@default")[1].trim();
          break;
        }
      }

      if (defaultValue !== undefined) break;
    }

    return defaultValue;
  }

  static removeCommentSyntax(commentText: string): string {
    return commentText
      .replace(/\/\*\*|\*\/|\*|\/\* ?/gm, "")
      .replace(/^  /gm, "")
      .trim();
  }

  static getFirstCommentBlock(sourceFile: ts.SourceFile): string | null {
    for (const statement of sourceFile.statements) {
      const comments = Comments.getCleanedCommentsForNode(
        statement,
        sourceFile,
      );
      if (comments) return comments;
    }

    return null;
  }

  static getTsDocCommentsForFunction(node: ts.Node, sourceFile: ts.SourceFile) {
    const params: Record<string, string> = {};
    const trivia =
      ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) || [];

    let comment = "";

    for (const range of trivia) {
      const commentText = Comments.removeCommentSyntax(
        sourceFile.text.substring(range.pos, range.end),
      );

      if (Comments.isV1DeprecationNotice(commentText)) continue;

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
