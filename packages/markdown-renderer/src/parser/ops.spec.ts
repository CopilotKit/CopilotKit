// Derived from hashbrown "Magic Text" (MIT, © LiveLoveApp, LLC). See NOTICE.
import { applyAstOps, createAstOpsFromDraft } from './ops';
import type { DraftNode } from './internal';
import type { StreamingMarkdownAstNode } from './types';
import type { TextSegment } from './types';

function createDraftRoot(): DraftNode {
  return {
    path: '0',
    type: 'document',
    range: { start: 0, end: 4 },
    closed: true,
    props: {},
    children: [
      {
        path: '0.0',
        type: 'paragraph',
        range: { start: 0, end: 4 },
        closed: true,
        props: {},
        children: [
          {
            path: '0.0.0',
            type: 'text',
            range: { start: 0, end: 4 },
            closed: true,
            props: { text: 'test', segments: [] },
            children: [],
          },
        ],
      },
    ],
  };
}

function createDraftRootWithText(
  text: string,
  segments: TextSegment[],
): DraftNode {
  return {
    path: '0',
    type: 'document',
    range: { start: 0, end: text.length },
    closed: true,
    props: {},
    children: [
      {
        path: '0.0',
        type: 'paragraph',
        range: { start: 0, end: text.length },
        closed: true,
        props: {},
        children: [
          {
            path: '0.0.0',
            type: 'text',
            range: { start: 0, end: text.length },
            closed: true,
            props: { text, segments },
            children: [],
          },
        ],
      },
    ],
  };
}

test('creates ops from draft and applies them to build AST state', () => {
  const draft = createDraftRoot();
  const ops = createAstOpsFromDraft(draft);

  const reduced = applyAstOps({
    previousNodes: [],
    previousPathToId: {},
    nextId: 1,
    ops,
  });

  expect(ops.some((op) => op.kind === 'upsert-node')).toBe(true);
  expect(reduced.nodes.some((node) => node.type === 'document')).toBe(true);
  expect(reduced.nodes.some((node) => node.type === 'paragraph')).toBe(true);
  expect(reduced.nodes.some((node) => node.type === 'text')).toBe(true);
});

test('reuses object identity for unchanged nodes and applies metadata ops', () => {
  const firstOps = createAstOpsFromDraft(createDraftRoot());
  const first = applyAstOps({
    previousNodes: [],
    previousPathToId: {},
    nextId: 1,
    ops: [
      { kind: 'set-warnings', warnings: [] },
      {
        kind: 'set-citations',
        citations: { order: [], numbers: {}, definitions: {} },
      },
      {
        kind: 'set-segmenter-warning-state',
        hasWarnedSegmenterUnavailable: false,
      },
      ...firstOps,
    ],
  });

  const secondOps = createAstOpsFromDraft(createDraftRoot());
  const second = applyAstOps({
    previousNodes: first.nodes,
    previousPathToId: first.pathToId,
    nextId: first.nextId,
    ops: [
      {
        kind: 'set-warnings',
        warnings: [{ code: 'unknown_construct', at: 0 }],
      },
      {
        kind: 'set-citations',
        citations: {
          order: ['a'],
          numbers: { a: 1 },
          definitions: { a: { id: 'a', text: 'alpha' } },
        },
      },
      {
        kind: 'set-segmenter-warning-state',
        hasWarnedSegmenterUnavailable: true,
      },
      ...secondOps,
    ],
  });

  const firstText = first.nodes.find((node) => node.type === 'text');
  const secondText = second.nodes.find((node) => node.type === 'text');

  expect(secondText).toBe(firstText);
  expect(second.warnings).toEqual([{ code: 'unknown_construct', at: 0 }]);
  expect(second.citations.order).toEqual(['a']);
  expect(second.hasWarnedSegmenterUnavailable).toBe(true);
});

test('throws when op stream does not include a root upsert-node', () => {
  expect(() =>
    applyAstOps({
      previousNodes: [],
      previousPathToId: {},
      nextId: 1,
      ops: [{ kind: 'set-warnings', warnings: [] }],
    }),
  ).toThrow('StreamingMarkdown op stream did not include a root node');
});

test('keeps shared segment identities while dropping stale segments when text contracts', () => {
  const previousSegments: TextSegment[] = [
    { start: 0, end: 1, text: ' ', kind: 'word', isWhitespace: true },
    { start: 1, end: 3, text: 'at', kind: 'word', isWhitespace: false },
    { start: 3, end: 4, text: ' ', kind: 'word', isWhitespace: true },
    { start: 4, end: 5, text: '[', kind: 'word', isWhitespace: false },
    { start: 5, end: 11, text: 'Waffle', kind: 'word', isWhitespace: false },
  ];
  const nextSegments: TextSegment[] = [
    { start: 0, end: 1, text: ' ', kind: 'word', isWhitespace: true },
    { start: 1, end: 3, text: 'at', kind: 'word', isWhitespace: false },
    { start: 3, end: 4, text: ' ', kind: 'word', isWhitespace: true },
  ];

  const first = applyAstOps({
    previousNodes: [],
    previousPathToId: {},
    nextId: 1,
    ops: createAstOpsFromDraft(
      createDraftRootWithText(' at [Waffle', previousSegments),
    ),
  });
  const second = applyAstOps({
    previousNodes: first.nodes,
    previousPathToId: first.pathToId,
    nextId: first.nextId,
    ops: createAstOpsFromDraft(createDraftRootWithText(' at ', nextSegments)),
  });

  const firstText = first.nodes.find(
    (node): node is Extract<StreamingMarkdownAstNode, { type: 'text' }> =>
      node.type === 'text',
  );
  const secondText = second.nodes.find(
    (node): node is Extract<StreamingMarkdownAstNode, { type: 'text' }> =>
      node.type === 'text',
  );

  expect(firstText).toBeDefined();
  expect(secondText).toBeDefined();
  expect(secondText?.text).toBe(' at ');
  expect(secondText?.segments).toHaveLength(3);
  expect(secondText?.segments.map((segment) => segment.text)).toEqual([
    ' ',
    'at',
    ' ',
  ]);
  expect(secondText?.segments[0]).toBe(firstText?.segments[0]);
  expect(secondText?.segments[1]).toBe(firstText?.segments[1]);
  expect(secondText?.segments[2]).toBe(firstText?.segments[2]);
});
