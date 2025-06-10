import { createWorkflow, createStep } from '@mastra/core/workflows';


import { z } from 'zod';

const haikuStep = createStep({
    id: 'haikuStep',
    description: 'A step for creating a haiku',
    inputSchema: z.object({
        topic: z.string(),
    }),
    outputSchema: z.object({
        // english: z.array(z.string()),
        // japanese: z.array(z.string()),
        // image_names: z.array(z.string()),
        out: z.any(),
        text: z.string()
    }),
    execute: async ({ inputData, mastra }) => {
        let haiku = await mastra.getAgent("haikuAgent").generate(inputData.topic);
        // console.log({ a : haiku?.steps[0].response?.messages[0].content, out: haiku.text })
        return {  out: haiku?.steps[0].response?.messages[0].content, text: haiku.text }
    },
});

// const summaryStep = createStep({
//     id: 'summaryStep',
//     description: 'A step for summarizing a document',
//     inputSchema: z.object({
//         document: z.string(),
//     }),
//     outputSchema: z.object({
//         summary: z.string(),
//     }),
//     execute: async ({ inputData, mastra }) => {
//         let summary = await mastra.getAgent("summaryAgent").generate(inputData.document);
//         return { summary: summary.text };
//     },
// });

const haikuWorkflow = createWorkflow({
    id: 'haikuWorkflow',
    description: 'A workflow for creating and summarizing documents',
    steps: [haikuStep],
    inputSchema: z.object({
        topic: z.string(),
    }),
    outputSchema: z.object({
        out: z.any(),
        text: z.string()
    }),
}).then(haikuStep).commit()

export default haikuWorkflow;

