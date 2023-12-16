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
export type BoldElement = {
  type: "bold";
  children: CustomText[];
};

export type ItalicElement = {
  type: "italic";
  children: CustomText[];
};

export type CustomElement = ParagraphElement | SuggestionElement | BoldElement | ItalicElement;
export type SuggestionAwareText = { text: string };
export type CustomText = SuggestionAwareText;

declare module "slate" {
  interface CustomTypes {
    Editor: CustomEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}
