import { createWorkflow, createStep } from '@mastra/core/workflows';


import { z } from 'zod';

const documentStep = createStep({
    id: 'documentStep',
    description: 'A step for creating a document',
    inputSchema: z.object({
        topic: z.string(),
    }),
    outputSchema: z.object({
        document: z.string(),
    }),
    execute: async ({ inputData, mastra }) => {
        let document = await mastra.getAgent("documentAgent").generate(inputData.topic);
        return { document: document.text };
    },
});

const summaryStep = createStep({
    id: 'summaryStep',
    description: 'A step for summarizing a document',
    inputSchema: z.object({
        document: z.string(),
    }),
    outputSchema: z.object({
        summary: z.string(),
    }),
    execute: async ({ inputData, mastra }) => {
        let summary = await mastra.getAgent("summaryAgent").generate(inputData.document);
        return { summary: summary.text };
    },
});

const docWorkflow = createWorkflow({
    id: 'documentWorkflow',
    description: 'A workflow for creating and summarizing documents',
    steps: [documentStep, summaryStep],
    inputSchema: z.object({
        topic: z.string(),
    }),
    outputSchema: z.object({
        document: z.string(),
        summary: z.string(),
    }),
}).then(documentStep).then(summaryStep).commit()

export default docWorkflow;

