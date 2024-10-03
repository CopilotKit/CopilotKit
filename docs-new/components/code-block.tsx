import React from 'react';
import * as Base from 'fumadocs-ui/components/codeblock';
import { Fragment } from 'react';
import { codeToHast } from 'shiki';
import { toJsxRuntime, type Jsx } from 'hast-util-to-jsx-runtime';
import { jsx, jsxs } from 'react/jsx-runtime';

export interface CodeBlockProps {
  code: string;
  wrapper?: Base.CodeBlockProps;
  lang: 'bash' | 'ts' | 'tsx' | 'json';
}

export async function CodeBlock({
  code,
  lang,
  wrapper,
}: CodeBlockProps): Promise<React.ReactElement> {
  const hast = await codeToHast(code, {
    lang,
    defaultColor: false,
    themes: {
      light: 'github-light',
      dark: 'github-dark',
    },
  });

  const rendered = toJsxRuntime(hast, {
    jsx: jsx as Jsx,
    jsxs: jsxs as Jsx,
    Fragment,
    development: false,
    components: {
      // @ts-expect-error -- JSX component
      pre: Base.Pre,
    },
  });

  return <Base.CodeBlock {...wrapper}>{rendered}</Base.CodeBlock>;
}
