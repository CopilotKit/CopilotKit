import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const generate_haiku = createTool({
    id: 'generate_haiku',
    description: 'Generate a haiku in Japanese and its English translation',
    inputSchema: z.object({
        japanese: z.array(z.string()),
        english: z.array(z.string()),
        image_names: z.array(z.string()),
    }),
    outputSchema: z.object({
        japanese: z.array(z.string()),
        english: z.array(z.string()),
        image_names: z.array(z.string()),
    }),
    execute: async ({ context: { japanese, english, image_names } }) => {
        console.log(japanese, english, image_names)
        return {
            japanese: japanese,
            english: english,
            image_names: image_names
        }
    }

});