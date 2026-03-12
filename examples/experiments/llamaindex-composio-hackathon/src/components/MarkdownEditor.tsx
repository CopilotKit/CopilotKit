"use client";

import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import MarkdownIt from "markdown-it";

type MarkdownEditorProps = {
  mdContent?: string;
  initialContent?: string;
  className?: string;
  setMdContent?: (state: any) => void;
  setBufferDocument?: (bufferDocument: string) => void;
};

export default function MarkdownEditor({ mdContent = "", initialContent = "", className, setMdContent, setBufferDocument }: MarkdownEditorProps) {
  function fromMarkdown(text: string) {
    const md = new MarkdownIt({
      typographer: true,
      html: true,
    });

    return md.render(text);
  }

  const isLocalUpdateRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    editorProps: {
      attributes: {
        class:
          "tiptap max-w-none focus:outline-none h-full min-h-full p-4 md:p-6 text-foreground",
      },
    },
    onUpdate({ editor }) {
      try {
        const html = editor.getHTML();
        // Mark this as a local edit to prevent setContent loop that moves the cursor
        isLocalUpdateRef.current = true;
        setMdContent?.((prev: any) => ({ ...prev, story: html }));
        setBufferDocument?.(html);
      } catch { }
    },
  });


  // Apply external content changes only when different from current editor HTML
  useEffect(() => {
    if (!editor) return;

    // If this change originated from onUpdate, skip applying content
    if (isLocalUpdateRef.current) {
      isLocalUpdateRef.current = false;
      return;
    }

    if (!mdContent) return;

    const nextHtml = fromMarkdown(mdContent);
    const currentHtml = editor.getHTML();
    if (currentHtml.trim() === nextHtml.trim()) return;

    // Update without emitting another update loop
    editor.commands.setContent(nextHtml, { emitUpdate: false });
  }, [mdContent, editor]);



  useEffect(() => {
    return () => {
      try {
        const html = editor?.getHTML() ?? "";
        setMdContent?.((prev: any) => ({ ...prev, story: html }));
        setBufferDocument?.(html);
      } catch { }
    };
  }, [editor]);

  return (
    <div className={className}>
      <div className="border rounded-xl bg-card h-full flex flex-col">
        <div className="flex-1 overflow-auto scroll-thin">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}


