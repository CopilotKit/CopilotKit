import {
  PiArrowSquareOutFill,
  PiArrowsLeftRightFill,
  PiBookBookmarkFill,
  PiBookOpenTextFill,
  PiBracketsCurlyFill,
  PiBooksFill,
  PiBrainFill,
  PiChatCircleDotsFill,
  PiChatsCircleFill,
  PiCookingPotFill,
  PiCursorClickFill,
  PiDatabaseFill,
  PiFileTextFill,
  PiGraduationCapFill,
  PiHandPalmFill,
  PiLayoutFill,
  PiListChecksFill,
  PiMicrophoneFill,
  PiPaintBrushBroadFill,
  PiPlantFill,
  PiPlayCircleFill,
  PiPlugsConnectedFill,
  PiPuzzlePieceFill,
  PiSquaresFourFill,
  PiStackFill,
  PiTerminalWindowFill,
  PiTreeStructureFill,
  PiWrenchFill,
} from "react-icons/pi";
import { IntelligenceKiteIcon } from "./intelligence-kite";

/*
 * Wayfinding glyphs: Phosphor's fill set, one place to change them. Solid
 * marks like the website's, so a 16px glyph still reads at a glance.
 * Controls (search, chevrons, checks, copy, theme) stay on Lucide, which is
 * what Fumadocs' own chrome ships with.
 */
export {
  PiPlayCircleFill as QuickstartGlyph,
  PiTerminalWindowFill as AgentsGlyph,
  PiPlantFill as BasicsGlyph,
  PiLayoutFill as GenerativeUIGlyph,
  PiCursorClickFill as InteractivityGlyph,
  PiPuzzlePieceFill as CapabilitiesGlyph,
  PiDatabaseFill as BackendGlyph,
  PiBookOpenTextFill as DocsGlyph,
  PiWrenchFill as OtherGlyph,
  PiHandPalmFill as HumanInTheLoopGlyph,
  PiArrowsLeftRightFill as SharedStateGlyph,
  PiChatsCircleFill as ThreadsGlyph,
  PiGraduationCapFill as LearningGlyph,
  PiBrainFill as MemoryGlyph,
  PiSquaresFourFill as DirectoryGlyph,
  // Examples, by what the demo shows.
  PiPaintBrushBroadFill as OpenGenUIGlyph,
  PiBracketsCurlyFill as DeclarativeUIGlyph,
  PiPlugsConnectedFill as MCPAppsGlyph,
  PiCursorClickFill as FrontendToolsGlyph,
  PiTreeStructureFill as SubagentsGlyph,
  PiMicrophoneFill as VoiceGlyph,
  PiListChecksFill as ToolRenderingGlyph,
  // The navbar's Guides menu.
  PiCookingPotFill as CookbookGlyph,
  PiBookBookmarkFill as ReferenceGlyph,
  // The "Ask AI" chat: its trigger, and what it reads and does.
  PiChatCircleDotsFill as AskAIGlyph,
  PiBooksFill as SourcesGlyph,
  PiStackFill as StackGlyph,
  PiArrowSquareOutFill as OpenPageGlyph,
  PiFileTextFill as PageGlyph,
};

/** Intelligence is marked with the kite outline the live docs use. */
export { IntelligenceKiteIcon as IntelligenceGlyph };
