import { BuiltInAgent } from '@copilotkit/runtime'

export const agent = new BuiltInAgent({ model: 'anthropic/claude-sonnet-4.5', prompt: 'Be brief.' })
