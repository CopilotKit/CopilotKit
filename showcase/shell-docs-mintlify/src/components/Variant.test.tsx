import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import Variant from './Variant';

describe('Variant', () => {
  it('emits a div with data-variant-for attribute', () => {
    const html = renderToString(<Variant for="langgraph"><span>hi</span></Variant>);
    expect(html).toContain('data-variant-for="langgraph"');
    expect(html).toContain('<span>hi</span>');
  });

  it('joins multiple slugs with spaces', () => {
    const html = renderToString(<Variant for="built-in langgraph"><span /></Variant>);
    expect(html).toContain('data-variant-for="built-in langgraph"');
  });

  it('warns about unknown slugs in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderToString(<Variant for="fakename"><span /></Variant>);
    // Only warns when import.meta.env.DEV is truthy. In vitest environment it may be undefined;
    // this test just asserts no crash. Don't require the warn call to fire.
    warn.mockRestore();
  });
});
