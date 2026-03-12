'use client'
import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { cn } from "@/lib/utils"
import { useCopilotReadable, useFrontendTool } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { CodeSnippet } from "@/components/code-snippet";
import {SqlTable} from "@/components/sql-table";

const databaseStructure = {
    Card: [
        { name: 'id', type: 'string' },
        { name: 'last4', type: 'string' },
        { name: 'expiry', type: 'string' },
        { name: 'type', type: 'CardBrand' },
        { name: 'color', type: 'string' },
        { name: 'pin', type: 'string' },
        { name: 'expensePolicyId', type: 'string?' },
    ],
    Member: [
        { name: 'id', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'role', type: 'MemberRole' },
        { name: 'team', type: 'ExpenseRole' },
    ],
    ExpensePolicy: [
        { name: 'id', type: 'string' },
        { name: 'type', type: 'ExpenseRole' },
        { name: 'limit', type: 'number' },
        { name: 'spent', type: 'number' },
    ],
    Transaction: [
        { name: 'id', type: 'string' },
        { name: 'title', type: 'string' },
        { name: 'note', type: 'TransactionNote?' },
        { name: 'amount', type: 'number' },
        { name: 'date', type: 'string' },
        { name: 'policyId', type: 'string' },
        { name: 'cardId', type: 'string' },
    ],
}

// The instructions here mocks a situation where the co-pilot LLM will be under completely different context than the rest of the app.
// In our actual case for this demo, the co-pilot is able to retrieve quite a lot of information, and will prefer it over writing an SQL query when asking things like "Show me all team members"
// Therefore, we have to "erase all data" and write a prompt that will consider this case
const SQL_AGENT_INSTRUCTIONS = `
                            *FORGET ALL DATA YOU HAVE*
                            
                            You are an SQL assistant. You are given a database and a question.
                            You need to provide a SQL query that answers the question. You can use the table structure to help you.
                            The table structure is as follows:
                            ${JSON.stringify(databaseStructure)}.
                            Return the entire query in one go (including all joints etc if require)
                            
                            You can only help the user by providing SQL queries or answers on SQL queries. You are not allowed to provide any data if you have it.
                        `

// Due to how this demo app is structured, we actually arrive at this page when CopilotKit has quite some information
// If we do not cap its knowledge with prompts, it is able to answers the questions without providing SQL queries.
// In a real world application, there would be context boundaries and the copilot used here will have far less context.
export default function Page() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true)

    const handleExecuteQuery = (query: string) => {
        // This is where you would typically send the query to your backend
        // For now, we'll just console it
        console.info('Execute query', query)
    }

    useCopilotReadable({
        description: "The structure of the database",
        value: databaseStructure
    });

    useFrontendTool({
        name: 'getSQLQueryForQuestion',
        description: '',
        parameters: [{
            name: 'query',
            type: 'string',
            description: 'The query for query result. MUST BE A VALID SQL QUERY. The full query (all lines) should be sent in one go',
            required: true,
        }],
        handler: async () => {},
        render: ({ args }) => {
            const { query } = args;
            const onExecute = async () => {
                if (!query) return;
                handleExecuteQuery(query)
            }
            return (
                <CodeSnippet code={query!} language='SQL' onExecute={onExecute} />
            )
        }
    })

    return (
        <div className="flex h-screen overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-auto p-6">
                    <h1 className="text-2xl font-bold mb-4">SQL Query</h1>
                    <h4 className="text-2xl font-bold mb-4">Ask a question, receive a query</h4>
                    <CopilotChat
                        className='h-[calc(100vh-200px)]'
                        instructions={SQL_AGENT_INSTRUCTIONS}
                        labels={{
                            title: "SQL Assistant",
                            initial: "Ask me anything and I will assist by providing a query",
                        }}
                    />
                </div>
            </div>
            <div className={cn(
                "border-l transition-all duration-300 ease-in-out",
                isSidebarOpen ? "w-80" : "w-0"
            )}>
                <div className="flex items-center justify-between p-4 bg-secondary">
                    <h2 className="text-lg font-semibold">Table Structure</h2>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    >
                        {isSidebarOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </Button>
                </div>
                <ScrollArea className="h-[calc(100vh-64px)] p-4">
                    <SqlTable databaseStructure={databaseStructure} />
                </ScrollArea>
            </div>
        </div>
    )
}
