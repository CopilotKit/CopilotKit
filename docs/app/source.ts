import { docs, meta } from '@/.source';
import { createMDXSource } from 'fumadocs-mdx';
import { loader } from 'fumadocs-core/source';
import { icon } from "@/lib/icons";

export const source = loader({
  baseUrl: '/',
  source: createMDXSource(docs, meta),
  icon,
});

export const referenceSource = loader({
  baseUrl: '/reference',
  source: createMDXSource(docs, meta),
  icon,
});

export const tutorialsSource = loader({
  baseUrl: '/tutorials',
  source: createMDXSource(docs, meta),
  icon,
});
