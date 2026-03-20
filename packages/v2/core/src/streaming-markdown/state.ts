// Derived from hashbrown/packages/core/src/magic-text/state.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * Streaming markdown parser state machine.
 *
 * Pure functional API:
 *   createMagicTextParserState()   → initial state
 *   parseMagicTextChunk(state, chunk) → new state with updated block tree
 *   finalizeMagicText(state)       → final state (flushes buffers)
 *
 * Same pattern as the JSON streaming parser — immutable state,
 * incremental processing, stable block IDs for React key stability.
 */

import {
  Block,
  BlockParserState,
  createBlockParserState,
  parseBlockChunk,
  finalizeBlocks,
} from "./block-parser";

// ─── Public types ──────────────────────────────────────────────

export interface MagicTextParserState {
  /** The current block tree — the parsed markdown structure */
  blocks: Block[];
  /** Internal block parser state (opaque to consumers) */
  _blockState: BlockParserState;
  /** Total characters consumed so far */
  consumed: number;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Create an initial parser state.
 */
export function createMagicTextParserState(): MagicTextParserState {
  const blockState = createBlockParserState();
  return {
    blocks: [],
    _blockState: blockState,
    consumed: 0,
  };
}

/**
 * Feed a chunk of text into the parser. Returns a new state with
 * the block tree updated.
 *
 * This is the core incremental parsing function. Feed chunks as they
 * arrive from the stream — the parser handles partial lines, buffering,
 * and all state transitions.
 *
 * @param state - The current parser state
 * @param chunk - A string chunk to parse (can be any length)
 * @returns A new parser state with updated blocks
 */
export function parseMagicTextChunk(
  state: MagicTextParserState,
  chunk: string,
): MagicTextParserState {
  const newBlockState = parseBlockChunk(state._blockState, chunk);

  // To get the current "view" of blocks for rendering, we finalize
  // a copy of the state (which flushes the buffer into blocks)
  // but keep the real un-finalized state for continued parsing.
  const viewState = finalizeBlocks(newBlockState);

  return {
    blocks: viewState.blocks,
    _blockState: newBlockState,
    consumed: state.consumed + chunk.length,
  };
}

/**
 * Finalize the parser — flush any remaining buffered text and close
 * any open structures.
 *
 * Call this when the stream is complete to get the final block tree.
 *
 * @param state - The current parser state
 * @returns The final parser state with all blocks resolved
 */
export function finalizeMagicText(
  state: MagicTextParserState,
): MagicTextParserState {
  const finalState = finalizeBlocks(state._blockState);
  return {
    blocks: finalState.blocks,
    _blockState: finalState,
    consumed: state.consumed,
  };
}
