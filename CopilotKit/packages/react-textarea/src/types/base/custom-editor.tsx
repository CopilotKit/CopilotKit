import { BaseEditor } from "slate";
import { ReactEditor } from "slate-react";
import { HistoryEditor } from "slate-history";

export type CustomEditor = BaseEditor & ReactEditor & HistoryEditor;

export type ParagraphElement = {
  type: "paragraph";
  children: CustomText[];
};

export type SuggestionElement = {
  type: "suggestion";
  inline: boolean;
  content: string;
  children: CustomText[];
};

export type CustomElement = ParagraphElement | SuggestionElement;
export type SuggestionAwareText = { text: string };
export type FormattingMarks = {
  bold?: boolean;
  italic?: boolean;
};
export type CustomText = SuggestionAwareText & FormattingMarks;

declare module "slate" {
  interface CustomTypes {
    Editor: CustomEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}
