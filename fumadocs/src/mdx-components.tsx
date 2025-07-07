import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import * as TabsComponents from 'fumadocs-ui/components/tabs';
import * as AccordionComponents from 'fumadocs-ui/components/accordion';
import * as StepsComponents from 'fumadocs-ui/components/steps';
import * as PropertyReferenceComponents from '@/components/content/property-reference';
import { Frame } from '@/components/content/frame';
import { createGenerator } from 'fumadocs-typescript';
import { AutoTypeTable } from 'fumadocs-typescript/ui';

const generator = createGenerator();


// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
    ...TabsComponents,
    ...AccordionComponents,
    ...StepsComponents,
    ...PropertyReferenceComponents,
    Frame,
    AutoTypeTable: (props) => (
      <AutoTypeTable {...props} generator={generator} />
    ),
  };
}
