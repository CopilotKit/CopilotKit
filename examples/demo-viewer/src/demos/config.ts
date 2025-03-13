import { DemoConfig } from '@/types/demo';

// A helper method to creating a config
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
        description: 'Haiku generator that uses tool based generative UI.',
        tags: ['Generative ui (action)', 'Tools'],
    }),
    createDemoConfig({
        id: 'shared_state',
        name: 'Shared State between agent and UI',
        description: 'A recipe copilot which reads and update collaboratively',
        tags: ['Agent State', 'Collaborating'],
    })
    // Add more demos here
];

export default config;
