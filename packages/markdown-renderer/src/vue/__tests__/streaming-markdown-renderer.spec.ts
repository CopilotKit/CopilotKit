import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import { StreamingMarkdownRenderer } from '../streaming-markdown-renderer';

describe('StreamingMarkdownRenderer (Vue)', () => {
  it('renders a heading from # Hi', () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: '# Hi', isComplete: true },
    });
    expect(w.find('h1').text()).toContain('Hi');
  });

  it('renders bold text from **b**', () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: '**b**', isComplete: true },
    });
    const strong = w.find('strong');
    expect(strong.exists()).toBe(true);
    expect(strong.text()).toBe('b');
  });

  it('renders a code block with pre>code', () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: '```\nx\n```', isComplete: true },
    });
    expect(w.find('pre code').text()).toContain('x');
  });

  it('sanitizes javascript: href on links', () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: '[x](javascript:alert(1))', isComplete: true },
    });
    const a = w.find('a');
    // href should be absent or undefined — not rendered
    expect(a.attributes('href')).toBeUndefined();
  });

  it('renders nothing for empty content', () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: '', isComplete: true },
    });
    // no paragraphs/headings/etc
    expect(w.find('p').exists()).toBe(false);
    expect(w.find('h1').exists()).toBe(false);
  });

  it('renders heading during streaming (isComplete: false)', () => {
    const w = mount(StreamingMarkdownRenderer, {
      props: { content: '# Partial', isComplete: false },
    });
    expect(w.find('h1').text()).toContain('Partial');
  });
});
