"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CopilotChat, useCopilotChatSuggestions } from "@copilotkit/react-ui"
import "@copilotkit/react-ui/styles.css";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import {
    Search,
    Sparkles,
    FileText,
    Twitter,
    TrendingUp,
    Send,
    User,
    ExternalLink,
    Globe,
    Brain,
    Zap,
    Star,
    ChevronDown,
    Check,
} from "lucide-react"
import { useCoAgent, useCoAgentStateRender, useCopilotAction, useCopilotChat } from "@copilotkit/react-core"
import { ToolLogs } from "@/components/ui/tool-logs"
import { XPost, XPostPreview, XPostCompact } from "@/components/ui/x-post"
import { LinkedInPost, LinkedInPostPreview, LinkedInPostCompact } from "@/components/ui/linkedin-post"
import { Button } from "@/components/ui/button"
import { initialPrompt1, suggestionPrompt1 } from "../prompts/prompts"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useParams, useRouter, usePathname, useSearchParams } from "next/navigation"
import { StackAnalysisCards } from "@/components/ui/stack-analysis-cards"
import { useLayout } from "../contexts/LayoutContext"


const agents = [
    {
        id: "post_generation_agent",
        name: "Post Generator",
        description: "Generate posts for Linkedin and X with Gemini and Google web search",
        icon: Search,
        gradient: "from-blue-500 to-purple-600",
        active: true,
    },
    {
        id: "stack_analysis_agent",
        name: "Stack Analyst",
        description: "Analyze the stack of a Project and generate insights from it",
        icon: FileText,
        gradient: "from-green-500 to-teal-600",
        active: false,
    }
]

const quickActions = [
    { label: "Staple", icon: FileText, color: "text-blue-600", prompt: "Analyze https://github.com/bertinetto/staple Github Repository" },
    { label: "Vim-airline", icon: FileText, color: "text-green-600", prompt: "Analyze https://github.com/vim-airline/vim-airline Github Repository" },
    { label: "Llama Index x AG-UI", icon: FileText, color: "text-purple-600", prompt: "Analyze https://github.com/copilotkit-support/open-ag-ui-demo-llamaindex Github Repository" },
    { label: "Mastra x AG-UI", icon: FileText, color: "text-orange-600", prompt: "Analyze https://github.com/copilotkit-support/open-ag-ui-demo-mastra Github Repository" },
]

interface PostInterface {
    tweet: {
        title: string
        content: string
    }
    linkedIn: {
        title: string
        content: string
    }
}


export default function StackAnalyzer() {
    const router = useRouter()
    const [selectedAgent, setSelectedAgent] = useState(agents[1])
    const [isAgentActive, setIsAgentActive] = useState(false)
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const { updateLayout } = useLayout()
    const { setState, running, state } = useCoAgent({
        name: "stack_analysis_agent",
        initialState: {
            tool_logs: [],
            show_cards : false,
            analysis : ""
        }
    })
    const { appendMessage, setMessages } = useCopilotChat()

    // useEffect(() => {
    //     console.log(state.show_cards, "running")
    // }, [state, visibleMessages])



    // Handle clicking outside dropdown to close it
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Element
            if (!target.closest('.dropdown-container')) {
                setIsDropdownOpen(false)
            }
        }

        if (isDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isDropdownOpen])


    useCoAgentStateRender({
        name: "stack_analysis_agent",
        render: (state) => {
            return <ToolLogs logs={state?.state?.tool_logs || []} />
        }
    })

    useCopilotChatSuggestions({
        available: "enabled",
        instructions: suggestionPrompt1,
    })

    
    return (
        <div className="flex h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 overflow-hidden">
            {/* Sidebar */}
            <div className="flex flex-col min-h-screen w-80 bg-white/80 backdrop-blur-xl border-r border-gray-200/50 shadow-xl">
                {/* Header */}
                <div className="h-40 p-4 border-b border-gray-100/50">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="relative">
                            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
                                <Brain className="w-6 h-6 text-white" />
                            </div>
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full flex items-center justify-center">
                                <Star className="w-2 h-2 text-white" />
                            </div>
                        </div>
                        <div>
                            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                                Open Gemini Canvas
                            </h1>
                            <p className="text-sm text-gray-600">Advanced AI Canvas</p>
                        </div>
                    </div>

                    {/* Enhanced Agent Selector */}
                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-gray-700">Active Agent</label>
                        <div className="relative dropdown-container">
                            <button
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className="w-full p-4 pr-8 border border-gray-200/50 rounded-xl bg-white/50 backdrop-blur-sm text-sm  transition-all duration-300 shadow-sm hover:shadow-md hover:bg-white/70 flex items-center justify-between group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-6 h-6 bg-gradient-to-r ${selectedAgent.gradient} rounded-lg flex items-center justify-center shadow-sm`}>
                                        <selectedAgent.icon className="w-4 h-4 text-white" />
                                    </div>
                                    <span className="font-medium text-gray-900">{selectedAgent.name}</span>
                                </div>
                                <ChevronDown
                                    className={cn(
                                        "w-4 h-4 text-gray-500 transition-transform duration-300",
                                        isDropdownOpen && "rotate-180"
                                    )}
                                />
                            </button>

                            {/* Dropdown Menu */}
                            <div className={cn(
                                "absolute top-full left-0 right-0 mt-1 bg-white/95 backdrop-blur-xl border border-gray-200/50 rounded-xl shadow-xl z-50 transition-all duration-300 transform origin-top",
                                isDropdownOpen
                                    ? "opacity-100 scale-100 translate-y-0"
                                    : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
                            )}>
                                <div className="p-1">
                                    {agents.map((agent) => (
                                        <button
                                            key={agent.id}
                                            onClick={() => {
                                                if (selectedAgent.id != agent.id) {
                                                    updateLayout({ agent: agent.id })
                                                    setMessages([])
                                                    setState({
                                                        tool_logs: [],
                                                        show_cards : false,
                                                        analysis : ""
                                                    })
                                                    router.push(`/post-generator`)
                                                }
                                                setIsDropdownOpen(false)
                                            }}
                                            className="w-full p-3 rounded-lg text-left transition-all duration-200 flex items-center gap-3 hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50 hover:shadow-sm group"
                                        >
                                            <div className={`w-6 h-6 bg-gradient-to-r ${agent.gradient} rounded-lg flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-200`}>
                                                <agent.icon className="w-4 h-4 text-white" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-gray-900 group-hover:text-blue-700 transition-colors duration-200">{agent.name}</span>
                                                    {selectedAgent.id === agent.id && (
                                                        <Check className="w-4 h-4 text-blue-600" />
                                                    )}
                                                </div>
                                                <p className="text-xs text-gray-500 mt-1 group-hover:text-gray-600 transition-colors duration-200">{agent.description}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>


                <div className="flex-1 overflow-auto">

                    {/* Chat Input at Bottom */}
                    <CopilotChat className="h-full p-2" labels={{
                        initial: initialPrompt1
                    }}
                        Input={({ onSend, inProgress }) => {
                            useEffect(() => {
                                if (inProgress) {
                                    setIsAgentActive(true)
                                } else {
                                    setIsAgentActive(false)
                                }
                            }, [inProgress])
                            const [input, setInput] = useState("")
                            return (<>
                                <div className="space-y-3">
                                    <form className="flex flex-col gap-3">
                                        <Textarea
                                            value={input}
                                            onKeyDown={(e) => {
                                                if (e.key.toLowerCase() === 'enter' && !inProgress) {
                                                    appendMessage(new TextMessage({
                                                        role: Role.User,
                                                        content: input
                                                    }))
                                                }
                                            }}
                                            onChange={(e) => setInput(e.target.value)}
                                            placeholder="Type your message..."
                                            className="min-h-[80px] resize-none rounded-xl border-muted-foreground/20 p-3"
                                        />
                                        <Button disabled={inProgress}

                                            onClick={(e) => {
                                                e.preventDefault()
                                                if (input.trim() === "") return
                                                console.log("sending message")
                                                onSend(input)
                                                setInput("")
                                            }} className="self-end rounded-xl px-5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white">
                                            <Send className="mr-2 h-4 w-4" />
                                            Send
                                        </Button>
                                    </form>
                                </div>
                            </>)
                        }}
                    />
                </div>

            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 p-6 shadow-sm flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-8 h-8 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                                <Sparkles className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-purple-800 bg-clip-text text-transparent">
                                    Analyze Github Repositories
                                </h2>
                                <p className="text-sm text-gray-600">Powered by Gemini AI & Google Web Search</p>

                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {isAgentActive && <Badge className="bg-gradient-to-r from-green-500 to-emerald-500 text-white border-0 shadow-sm">
                                <div className="w-2 h-2 bg-white rounded-full mr-2 animate-pulse"></div>
                                Live Research
                            </Badge>}
                            {/* <div className="w-8 h-8 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div> */}
                        </div>
                    </div>
                </div>

                {/* Main Canvas */}
                <div className="flex-1 p-6 overflow-y-auto">
                    {(state?.show_cards) ? (
                        <StackAnalysisCards analysis={state?.analysis} />
                    ) : (
                        <div className="text-center py-16">
                            <div className="relative mb-8">
                                <div className="w-20 h-20 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto shadow-2xl">
                                    <Brain className="w-10 h-10 text-white" />
                                </div>
                            </div>
                            <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-purple-800 bg-clip-text text-transparent mb-3">
                                Ready to Explore
                            </h3>
                            <p className="text-gray-600 mb-8 max-w-md mx-auto leading-relaxed">
                                Harness the power of Google's most advanced AI models for analyzing the stack of GitHub projects.
                            </p>
                            <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto">
                                {quickActions.slice(0, 4).map((action, index) => (
                                    <Button
                                        key={index}
                                        variant="outline"
                                        disabled={isAgentActive}

                                        className="h-auto p-6 flex flex-col items-center gap-3 bg-white/50 backdrop-blur-sm border-gray-200/50 hover:bg-gradient-to-r hover:from-blue-50 hover:to-purple-50 rounded-xl transition-all duration-300 group"
                                        onClick={() => appendMessage(new TextMessage({
                                            role: Role.User,
                                            content: action.prompt
                                        }))}
                                    >
                                        <action.icon
                                            className={`w-6 h-6 ${action.color} group-hover:scale-110 transition-transform duration-200`}
                                        />
                                        <span className="text-sm font-medium">{action.label}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div >
    )
}
