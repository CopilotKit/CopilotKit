import React from "react";
import { Editor } from "slate";
import { ReactEditor } from "slate-react";
import { getFullEditorTextWithNewlines } from "../../lib/get-text-around-cursor";
import { replaceEditorText } from "../../lib/slatejs-edits/replace-text";
import { HTMLCopilotTextAreaElement } from "../../types";
import { CustomEditor } from "../../types/base/custom-editor";

export function usePopulateCopilotTextareaRef(
  editor: Editor,
  ref: React.Ref<HTMLCopilotTextAreaElement>,
) {
  React.useImperativeHandle(ref, () => {
    class Combined {
      constructor(
        private customMethods: CustomMethods,
        private editorHtmlElement: HTMLElement,
      ) {}

      [key: string]: any;

      get(target: any, propKey: string): any {
        if (this.isKeyOfCustomMethods(propKey)) {
          const value = this.customMethods[propKey];
          if (typeof value === "function") {
            return value.bind(this.customMethods);
          }
          return value;
        } else if (this.isKeyOfHTMLElement(propKey)) {
          const value = this.editorHtmlElement[propKey];
          if (typeof value === "function") {
            return value.bind(this.editorHtmlElement);
          }
          return value;
        }
      }

      set(target: any, propKey: string, value: any): boolean {
        if (this.isKeyOfCustomMethods(propKey)) {
          (this.customMethods as any)[propKey] = value;
        } else if (this.isKeyOfHTMLElement(propKey)) {
          (this.editorHtmlElement as any)[propKey] = value;
        } else {
          // Default behavior (optional)
          target[propKey] = value;
        }
        return true;
      }

      private isKeyOfCustomMethods(key: string): key is keyof CustomMethods {
        return key in this.customMethods;
      }

      private isKeyOfHTMLElement(key: string): key is keyof HTMLElement {
        return key in this.editorHtmlElement;
      }
    }

    const handler = {
      get(target: any, propKey: keyof CustomMethods | keyof HTMLElement) {
        return target.get(target, propKey);
      },
      set(target: any, propKey: keyof CustomMethods | keyof HTMLElement, value: any) {
        return target.set(target, propKey, value);
      },
    };

    class CustomMethods {
      constructor(private editor: CustomEditor) {}

      focus() {
        ReactEditor.focus(this.editor);
      }

      blur() {
        ReactEditor.blur(this.editor);
      }

      get value() {
        return getFullEditorTextWithNewlines(this.editor);
      }
      set value(value: string) {
        replaceEditorText(this.editor, value);
      }
    }

    const editorHtmlElement = ReactEditor.toDOMNode(editor, editor);
    const customMethods = new CustomMethods(editor);

    const combined = new Combined(customMethods, editorHtmlElement);
    return new Proxy(combined, handler);
  }, [editor]);
}
