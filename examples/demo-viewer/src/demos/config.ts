import { DemoConfig } from '@/types/demo';

function createDemoConfig({
    id,
    name,
    description,
    tags,
}: Pick<DemoConfig, 'id' | 'name' | 'description' | 'tags'>): DemoConfig {
    return ({
        id,
        name,
        description,
        path: `agent/demo/${id}`,
        component: () => import(`../../agent/demo/${id}/page`).then(mod => mod.default),
        defaultLLMProvider: 'openai',
        tags,
    })
}

const config: DemoConfig[] = [
    createDemoConfig({
        id: 'agentic_chat',
        name: 'Agentic Chat',
        description: 'Chat capability with streaming!',
        tags: ['Chat', 'Streaming'],
    }),
    createDemoConfig({
        id: 'tool_based_generative_ui',
        name: 'Tool Based Generative UI',
        description: 'LLM Generative UI using tools',
        tags: ['Generative ui (action)', 'Tools'],
    })
    // Add more demos here
];

export default config;
