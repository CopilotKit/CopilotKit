import { describe, it, expect } from "vitest";
import jscodeshift from "jscodeshift";
import transform from "../remove-stylesheet-import";

const j = jscodeshift.withParser("tsx");

function run(source: string, path = "test.tsx") {
  const reports: string[] = [];
  const result = transform(
    { source, path },
    {
      jscodeshift: j,
      j,
      stats: () => {},
      report: (message: string) => reports.push(message),
    },
  );
  return { output: result ?? source, changed: result !== undefined, reports };
}

describe("remove-stylesheet-import codemod", () => {
  describe("JS and TS files", () => {
    it("removes only the import line and leaves the rest of the file byte-for-byte", () => {
      const { output, changed } = run(`"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import "./app.css";

export default function Page({ wide }: { wide: boolean }) {
  return wide ? (
    // Desktop
    <>
      <CopilotChat />
    </>
  ) : (
    <CopilotChat />
  );
}
`);

      expect(changed).toBe(true);
      expect(output).toBe(`"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import "./app.css";

export default function Page({ wide }: { wide: boolean }) {
  return wide ? (
    // Desktop
    <>
      <CopilotChat />
    </>
  ) : (
    <CopilotChat />
  );
}
`);
    });

    it("removes the react-ui re-export and the built dist path", () => {
      const { output } = run(`import "@copilotkit/react-ui/v2/styles.css";
import "@copilotkit/react-core/dist/v2/index.css";
import { App } from "./App";
`);

      expect(output).not.toContain("@copilotkit/react-ui/v2/styles.css");
      expect(output).not.toContain("@copilotkit/react-core/dist/v2/index.css");
      expect(output).toContain('import { App } from "./App";');
    });

    it("keeps a comment that sat above the removed import", () => {
      const { output } = run(`// Copyright Acme Inc.
import "@copilotkit/react-core/v2/styles.css";
import { App } from "./App";
`);

      expect(output).toBe(`// Copyright Acme Inc.
import { App } from "./App";
`);
    });

    it("removes a require statement", () => {
      const { output, changed } = run(
        `require("@copilotkit/react-core/v2/styles.css");
const App = require("./App");
`,
        "test.js",
      );

      expect(changed).toBe(true);
      expect(output).not.toContain("styles.css");
      expect(output).toContain('const App = require("./App");');
    });

    it("leaves an import that binds a name, and reports it", () => {
      const source = `import styles from "@copilotkit/react-core/v2/styles.css";
console.log(styles);
`;
      const { output, changed, reports } = run(source);

      expect(changed).toBe(false);
      expect(output).toBe(source);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain("remove it by hand");
    });

    it("does not change a file without the import", () => {
      const { changed } = run(`import "./styles.css";
import "@copilotkit/react-core/v2";
`);

      expect(changed).toBe(false);
    });
  });

  describe("CSS files", () => {
    it("removes every @import form of the stylesheets and keeps other imports", () => {
      const { output, changed } = run(
        `@import "tailwindcss";
@import "@copilotkit/react-core/v2/styles.css";
@import '@copilotkit/react-core/v2/styles.css' layer(copilotkit);
@import url("@copilotkit/react-ui/v2/styles.css");
@import url(@copilotkit/react-core/dist/v2/index.css) screen;

:root {
  --brand: red;
}
`,
        "globals.css",
      );

      expect(changed).toBe(true);
      expect(output).toBe(`@import "tailwindcss";

:root {
  --brand: red;
}
`);
    });

    it("handles SCSS and an import on the last line without a newline", () => {
      const { output } = run(
        `$brand: red;
@import "@copilotkit/react-core/v2/styles.css";`,
        "styles.scss",
      );

      expect(output).toBe("$brand: red;\n");
    });

    it("empties a stylesheet that held only the import", () => {
      // jscodeshift skips an empty result, so the file becomes one newline.
      const { output, changed } = run(
        `@import "@copilotkit/react-core/v2/styles.css";\n`,
        "styles.css",
      );

      expect(changed).toBe(true);
      expect(output).toBe("\n");
    });

    it("does not change a stylesheet without the import", () => {
      const { changed } = run(`@import "./theme.css";`, "globals.css");

      expect(changed).toBe(false);
    });
  });
});
