import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './.mintlify/docs' }),
  schema: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    sidebarTitle: z.string().optional(),
    deprecated: z.boolean().optional(),
    lastUpdatedDate: z.string().optional(),
    createdDate: z.string().optional(),
  }),
});

export const collections = { docs };
