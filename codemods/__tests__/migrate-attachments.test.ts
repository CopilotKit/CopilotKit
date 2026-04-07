import { describe, it, expect } from "vitest";
import jscodeshift from "jscodeshift";
import transform from "../migrate-attachments";

const j = jscodeshift.withParser("tsx");

function run(source: string): string {
  const result = transform(
    { source, path: "test.tsx" },
    { jscodeshift: j, j, stats: () => {}, report: () => {} },
  );
  return result ?? source;
}

describe("migrate-attachments codemod", () => {
  // -----------------------------------------------------------------------
  // Props transformation
  // -----------------------------------------------------------------------

  describe("JSX props", () => {
    it("transforms imageUploadsEnabled to attachments", () => {
      const input = `
import { CopilotChat } from "@copilotkit/react-ui";
<CopilotChat imageUploadsEnabled={true} />;
`;
      const output = run(input);
      expect(output).toContain("attachments={{");
      expect(output).toContain("enabled: true");
      expect(output).not.toContain("imageUploadsEnabled");
    });

    it("transforms inputFileAccept to attachments.accept", () => {
      const input = `
import { CopilotChat } from "@copilotkit/react-ui";
<CopilotChat inputFileAccept="image/*" />;
`;
      const output = run(input);
      expect(output).toContain('accept: "image/*"');
      expect(output).not.toContain("inputFileAccept");
    });

    it("merges both props into a single attachments object", () => {
      const input = `
import { CopilotChat } from "@copilotkit/react-ui";
<CopilotChat imageUploadsEnabled={true} inputFileAccept="image/*,.pdf" />;
`;
      const output = run(input);
      expect(output).toContain("enabled: true");
      expect(output).toContain('accept: "image/*,.pdf"');
      expect(output).not.toContain("imageUploadsEnabled");
      expect(output).not.toContain("inputFileAccept");
    });

    it("works on CopilotSidebar", () => {
      const input = `
import { CopilotSidebar } from "@copilotkit/react-ui";
<CopilotSidebar imageUploadsEnabled={true} />;
`;
      const output = run(input);
      expect(output).toContain("attachments={{");
      expect(output).not.toContain("imageUploadsEnabled");
    });

    it("works on CopilotPopup", () => {
      const input = `
import { CopilotPopup } from "@copilotkit/react-ui";
<CopilotPopup imageUploadsEnabled={true} />;
`;
      const output = run(input);
      expect(output).toContain("attachments={{");
      expect(output).not.toContain("imageUploadsEnabled");
    });

    it("preserves other props", () => {
      const input = `
import { CopilotChat } from "@copilotkit/react-ui";
<CopilotChat className="my-chat" imageUploadsEnabled={true} labels={{ placeholder: "Ask..." }} />;
`;
      const output = run(input);
      expect(output).toContain('className="my-chat"');
      expect(output).toContain("labels=");
      expect(output).toContain("attachments={{");
    });

    it("preserves imageUploadsEnabled={false}", () => {
      const input = `
import { CopilotChat } from "@copilotkit/react-ui";
<CopilotChat imageUploadsEnabled={false} />;
`;
      const output = run(input);
      expect(output).toContain("enabled: false");
      expect(output).not.toContain("enabled: true");
    });

    it("preserves dynamic imageUploadsEnabled expression", () => {
      const input = `
import { CopilotChat } from "@copilotkit/react-ui";
<CopilotChat imageUploadsEnabled={isEnabled} />;
`;
      const output = run(input);
      expect(output).toContain("enabled: isEnabled");
    });

    it("handles shorthand imageUploadsEnabled (no value)", () => {
      const input = `
import { CopilotChat } from "@copilotkit/react-ui";
<CopilotChat imageUploadsEnabled />;
`;
      const output = run(input);
      expect(output).toContain("enabled: true");
    });

    it("skips if attachments prop already exists", () => {
      const input = `
import { CopilotChat } from "@copilotkit/react-ui";
<CopilotChat imageUploadsEnabled={true} attachments={{ enabled: true }} />;
`;
      const output = run(input);
      // Should not double-add attachments — leaves as-is
      expect(output).toContain("imageUploadsEnabled");
    });

    it("preserves dynamic inputFileAccept expression", () => {
      const input = `
import { CopilotChat } from "@copilotkit/react-ui";
<CopilotChat imageUploadsEnabled={true} inputFileAccept={acceptTypes} />;
`;
      const output = run(input);
      expect(output).toContain("accept: acceptTypes");
      expect(output).toContain("enabled: true");
      expect(output).not.toContain("inputFileAccept");
    });

    it("ignores non-CopilotKit components", () => {
      const input = `
<SomeOtherChat imageUploadsEnabled={true} />;
`;
      const output = run(input);
      expect(output).toContain("imageUploadsEnabled");
    });
  });

  // -----------------------------------------------------------------------
  // Import renames
  // -----------------------------------------------------------------------

  describe("import renames", () => {
    it("renames ImageUploadQueue to AttachmentQueue", () => {
      const input = `
import { ImageUploadQueue } from "@copilotkit/react-ui";
<ImageUploadQueue images={imgs} />;
`;
      const output = run(input);
      expect(output).toContain("AttachmentQueue");
      expect(output).not.toContain("ImageUploadQueue");
    });

    it("renames ImageUpload type to Attachment", () => {
      const input = `
import type { ImageUpload } from "@copilotkit/react-ui";
const x: ImageUpload = { contentType: "", bytes: "" };
`;
      const output = run(input);
      expect(output).toContain("Attachment");
      expect(output).not.toContain("ImageUpload");
    });

    it("handles aliased imports (keeps alias, renames imported)", () => {
      const input = `
import { ImageUploadQueue as MyQueue } from "@copilotkit/react-ui";
<MyQueue images={imgs} />;
`;
      const output = run(input);
      // Imported name changes, but local alias stays
      expect(output).toContain("AttachmentQueue as MyQueue");
      expect(output).toContain("<MyQueue");
    });

    it("ignores imports from other packages", () => {
      const input = `
import { ImageUploadQueue } from "some-other-package";
`;
      const output = run(input);
      expect(output).toContain("ImageUploadQueue");
      expect(output).not.toContain("AttachmentQueue");
    });

    it("does not rename local variables that shadow the import name", () => {
      const input = `
import type { ImageUpload } from "@copilotkit/react-ui";
const x: ImageUpload = {} as any;
const ImageUpload = "unrelated local variable";
console.log(ImageUpload);
`;
      const output = run(input);
      // Import and type reference should be renamed
      expect(output).toContain("import type { Attachment }");
      expect(output).toContain("const x: Attachment");
      // Local variable declaration and its reference should NOT be renamed
      expect(output).toContain(
        'const ImageUpload = "unrelated local variable"',
      );
      expect(output).toContain("console.log(ImageUpload)");
    });

    it("does not rename object property keys or member expressions", () => {
      const input = `
import type { ImageUpload } from "@copilotkit/react-ui";
const x: ImageUpload = {} as any;
const config = { ImageUpload: true };
const val = obj.ImageUpload;
`;
      const output = run(input);
      // Import and type reference should be renamed
      expect(output).toContain("import type { Attachment }");
      expect(output).toContain("const x: Attachment");
      // Object key and member access should NOT be renamed
      expect(output).toContain("{ ImageUpload: true }");
      expect(output).toContain("obj.ImageUpload");
    });
  });

  // -----------------------------------------------------------------------
  // Idempotency and no-op
  // -----------------------------------------------------------------------

  describe("idempotency", () => {
    it("running twice produces the same result", () => {
      const input = `
import { CopilotChat, ImageUploadQueue } from "@copilotkit/react-ui";
<CopilotChat imageUploadsEnabled={true} inputFileAccept="image/*" />;
<ImageUploadQueue images={imgs} />;
`;
      const first = run(input);
      const second = run(first);
      expect(second).toBe(first);
    });
  });

  describe("no-op on unrelated code", () => {
    it("does not modify files without deprecated APIs", () => {
      const input = `
import { useState } from "react";
function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
`;
      const output = run(input);
      expect(output).toBe(input);
    });

    it("does not modify already-migrated code", () => {
      const input = `
import { CopilotChat, AttachmentQueue } from "@copilotkit/react-ui";
import type { Attachment } from "@copilotkit/react-ui";
<CopilotChat attachments={{ enabled: true, accept: "image/*" }} />;
`;
      const output = run(input);
      expect(output).toBe(input);
    });
  });
});
